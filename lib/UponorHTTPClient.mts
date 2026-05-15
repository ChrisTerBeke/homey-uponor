import { CACHE_EXPIRATION_MS, FETCH_TIMEOUT_MS } from './constants.mjs';

export type Mode = 'auto' | 'heat' | 'cool' | 'off' | 'holiday' | 'eco';

export type Thermostat = {
    id: string | undefined;
    controllerID: number | undefined;
    thermostatID: number | undefined;
    name: string | undefined;
    temperature: number | undefined;
    manifoldHeadTemperature: number | undefined;
    setPoint: number | undefined;
    minimumSetPoint: number | undefined;
    maximumSetPoint: number | undefined;
    mode: Mode | undefined;
    humidity: number | undefined;
    active: boolean;
    bypassEnabled: boolean;
    ecoMode: boolean;
    valvePosPercent: number | undefined;
    alarms: {
        battery: boolean;
        tamper: boolean;
        airSensor: boolean;
        extSensor: boolean;
        rhSensor: boolean;
        rfError: boolean;
        rfLowSig: boolean;
        valvePos: boolean;
        heatFallback: boolean;
    };
};

type AttributesResponse = {
    result: string;
    output?: {
        vars?: {
            waspVarName: string;
            waspVarValue: string;
        }[];
    };
};

function round(value: number, precision: number = 0): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

export class UponorHTTPClient {

  private _url: string;
  private _lastSync: Date | undefined;
  private _rawAttributes: unknown;
  private _attributes: Map<string, string> = new Map();
  private _thermostats: Map<string, Thermostat> = new Map();
  private _syncPromise: Promise<boolean | null> | null = null;

  constructor(ipAddress: string) {
    this._url = `http://${ipAddress}/JNAP/`;
  }

  public async updateAddress(newAddress: string): Promise<boolean> {
    this._url = `http://${newAddress}/JNAP/`;
    return this.testConnection();
  }

  public getAttributes(): Map<string, string> {
    return this._attributes;
  }

  public getAttribute(name: string): string | undefined {
    return this._attributes.get(name);
  }

  public getThermostats(): Map<string, Thermostat> {
    return this._thermostats;
  }

  public getThermostat(controllerID: number, thermostatID: number): Thermostat | undefined {
    const ctKey = UponorHTTPClient._createKey(controllerID, thermostatID);
    return this._thermostats.get(ctKey);
  }

  public async syncAttributes(): Promise<void> {
    const fetchedNew = await this._syncRawAttributes();
    if (fetchedNew === null) throw new Error('Could not sync raw attributes');

    // If fetchedNew is true, it means we actually got new data from the network
    if (fetchedNew) {
      const parsed = await this._parseAttributes();
      if (!parsed) throw new Error('Could not parse attributes');
      await this._syncThermostats();
    }
  }

  public async debug(): Promise<unknown> {
    return this._rawAttributes;
  }

  public async testConnection(): Promise<boolean> {
    try {
      const result = await this._syncRawAttributes(true);
      return result === true;
    } catch (error) {
      return false;
    }
  }

  public async setThermostatName(controllerID: number, thermostatID: number, name: string): Promise<void> {
    await this._setAttributes(new Map([[`cust_C${controllerID}_T${thermostatID}_name`, name]]));
    const ctKey = UponorHTTPClient._createKey(controllerID, thermostatID);
    this._attributes.set(`cust_C${controllerID}_T${thermostatID}_name`, name);
    const thermostat = this._thermostats.get(ctKey);
    if (thermostat) thermostat.name = name;
  }

  public async setThermostatEcoMode(controllerID: number, thermostatID: number, enabled: boolean): Promise<void> {
    const value = enabled ? '1' : '0';
    await this._setAttributes(new Map([[`C${controllerID}_T${thermostatID}_mode_comfort_eco`, value]]));
    const ctKey = UponorHTTPClient._createKey(controllerID, thermostatID);
    this._attributes.set(`C${controllerID}_T${thermostatID}_mode_comfort_eco`, value);
    const thermostat = this._thermostats.get(ctKey);
    if (thermostat) thermostat.ecoMode = enabled;
  }

  public getGlobalEcoMode(): boolean {
    return this.getAttribute('sys_forced_eco_mode') === '1';
  }

  public async setGlobalEcoMode(enabled: boolean): Promise<void> {
    const value = enabled ? '1' : '0';
    await this._setAttributes(new Map([['sys_forced_eco_mode', value]]));
    this._attributes.set('sys_forced_eco_mode', value);
  }

  public getGlobalHeatCoolMode(): 'heat' | 'cool' {
    return this.getAttribute('sys_heat_cool_mode') === '1' ? 'cool' : 'heat';
  }

  public getControllerName(controllerID: number): string {
    return this.getAttribute(`cust_Controller${controllerID}_Name`) || `Controller ${controllerID}`;
  }

  public getWifiName(): string | undefined {
    return this.getAttribute('cust_wifi_device');
  }

  public getSystemMetrics(controllerID: number = 1): {
    generalSystemAlarm: boolean;
    coolingAvailable: boolean;
    } {
    return {
      generalSystemAlarm: this.getAttribute(`C${controllerID}_stat_general_system_alarm`) === '1',
      coolingAvailable: this.getAttribute('sys_cooling_available') === '1',
    };
  }

  public async setGlobalHeatCoolMode(mode: 'heat' | 'cool'): Promise<void> {
    const value = mode === 'cool' ? '1' : '0';
    await this._setAttributes(new Map([['sys_heat_cool_mode', value]]));
    this._attributes.set('sys_heat_cool_mode', value);
  }

  public async setTargetTemperature(controllerID: number, thermostatID: number, value: number): Promise<void> {
    const fahrenheit = (value * (9 / 5)) + 32;
    const setPoint = round(fahrenheit * 10, 0).toString();
    await this._setAttributes(new Map([[`C${controllerID}_T${thermostatID}_setpoint`, setPoint]]));

    // Optimistically update cache to prevent immediate fetch spikes
    const ctKey = UponorHTTPClient._createKey(controllerID, thermostatID);
    this._attributes.set(`C${controllerID}_T${thermostatID}_setpoint`, setPoint);
    const thermostat = this._thermostats.get(ctKey);
    if (thermostat) thermostat.setPoint = value;
  }

  // Returns true if new data was fetched, false if returned from cache, null on error
  private async _syncRawAttributes(force: boolean = false): Promise<boolean | null> {
    if (!force && this._lastSync && (new Date().getTime() - this._lastSync.getTime()) < CACHE_EXPIRATION_MS) {
      return false; // from cache
    }

    if (this._syncPromise && !force) {
      return this._syncPromise; // waits for the fetch, so it will be a "fresh" fetch for this caller too
    }

    this._syncPromise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        console.log(`[JNAP] POST ${this._url} - Action: http://phyn.com/jnap/uponorsky/GetAttributes - Body: {}`);
        const request = await fetch(this._url, {
          method: 'POST',
          headers: { 'x-jnap-action': 'http://phyn.com/jnap/uponorsky/GetAttributes' },
          body: '{}',
          signal: controller.signal as any,
        });
        clearTimeout(timeout);
        this._lastSync = new Date();
        this._rawAttributes = await request.json();
        const responseData = this._rawAttributes as AttributesResponse;
        console.log(`[JNAP] Response status: ${request.status} - Result: ${responseData?.result} - Variables count: ${responseData?.output?.vars?.length || 0}`);
        return request.status === 200 ? true : null;
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      } finally {
        this._syncPromise = null;
      }
    })();

    return this._syncPromise;
  }

  private async _parseAttributes(): Promise<boolean> {
    const data = this._rawAttributes as AttributesResponse;
    if (!data || data.result !== 'OK' || !data.output || !data.output.vars) return false;
    this._attributes = new Map(data.output.vars.map((v) => [v.waspVarName, v.waspVarValue]));
    return true;
  }

  private async _syncThermostats(): Promise<void> {
    const attributes = this.getAttributes();
    const thermostats: Map<string, Thermostat> = new Map();

    attributes.forEach((value, key) => {
      const regex = /cust_C(\d+)_T(\d+)_name/;
      const matches = regex.exec(key);
      if (!matches) return;
      const controllerID = matches[1]; // first capture group
      const thermostatID = matches[2]; // second capture group
      const ctKey = UponorHTTPClient._createKey(controllerID, thermostatID);

      thermostats.set(ctKey, {
        id: ctKey,
        name: value,
        controllerID: parseInt(controllerID, 10),
        thermostatID: parseInt(thermostatID, 10),
        temperature: UponorHTTPClient._formatTemperature(this.getAttribute(`${ctKey}_room_temperature`)),
        manifoldHeadTemperature: UponorHTTPClient._parseFahrenheit(this.getAttribute(`${ctKey}_head1_supply_temp`)),
        setPoint: UponorHTTPClient._formatTemperature(this.getAttribute(`${ctKey}_setpoint`)),
        minimumSetPoint: UponorHTTPClient._formatTemperature(this.getAttribute(`${ctKey}_minimum_setpoint`)),
        maximumSetPoint: UponorHTTPClient._formatTemperature(this.getAttribute(`${ctKey}_maximum_setpoint`)),
        mode: this.getGlobalHeatCoolMode(),
        humidity: parseInt(this.getAttribute(`${ctKey}_rh`) || '', 10) || undefined,
        active: this.getAttribute(`${ctKey}_stat_cb_actuator`) === '1',
        bypassEnabled: this.getAttribute(`${ctKey}_bypass_enable`) === '1',
        ecoMode: this.getAttribute(`${ctKey}_mode_comfort_eco`) === '1',
        valvePosPercent: UponorHTTPClient._parseNumber(this.getAttribute(`${ctKey}_head1_valve_pos_percent`)),
        alarms: {
          battery: this.getAttribute(`${ctKey}_stat_battery_error`) === '1',
          tamper: this.getAttribute(`${ctKey}_stat_tamper_alarm`) === '1',
          airSensor: this.getAttribute(`${ctKey}_stat_air_sensor_error`) === '1',
          extSensor: this.getAttribute(`${ctKey}_stat_external_sensor_err`) === '1',
          rhSensor: this.getAttribute(`${ctKey}_stat_rh_sensor_error`) === '1',
          rfError: this.getAttribute(`${ctKey}_stat_rf_error`) === '1',
          rfLowSig: this.getAttribute(`${ctKey}_stat_rf_low_sig_warning`) === '1',
          valvePos: this.getAttribute(`${ctKey}_stat_valve_position_err`) === '1',
          heatFallback: this.getAttribute(`${ctKey}_stat_cb_fallbk_heatalarm`) === '1',
        },
      });
    });

    this._thermostats = thermostats;
  }

  private async _setAttributes(attributes: Map<string, string>): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const vars = Array.from(attributes, ([key, value]) => [{ waspVarName: key, waspVarValue: value }]).flat();
      const body = JSON.stringify({ vars });
      console.log(`[JNAP] POST ${this._url} - Action: http://phyn.com/jnap/uponorsky/SetAttributes - Body: ${body}`);
      const request = await fetch(this._url, {
        method: 'POST',
        headers: { 'x-jnap-action': 'http://phyn.com/jnap/uponorsky/SetAttributes' },
        body,
        signal: controller.signal as any,
      });
      clearTimeout(timeout);
      const data: AttributesResponse = await request.json() as AttributesResponse;
      console.log(`[JNAP] Response status: ${request.status} - Body: ${JSON.stringify(data)}`);
      if (data.result !== 'OK') throw new Error(data.result);
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private static _formatTemperature(input: string | undefined): number | undefined {
    if (!input) return undefined;
    const fahrenheitRaw = parseFloat(input);
    if (Number.isNaN(fahrenheitRaw)) return undefined;
    const fahrenheit = fahrenheitRaw / 10;
    const celsius = (fahrenheit - 32) * (5 / 9);
    return round(celsius, 1);
  }

  private static _parseFahrenheit(input: string | undefined): number | undefined {
    if (!input) return undefined;
    const value = parseFloat(input);
    if (Number.isNaN(value)) return undefined;
    const celsius = (value - 32) * (5 / 9);
    return round(celsius, 1);
  }

  private static _parseNumber(input: string | undefined): number | undefined {
    if (!input) return undefined;
    const value = parseInt(input, 10);
    if (Number.isNaN(value)) return undefined;
    return value;
  }

  private static _createKey(controllerID: string | number, thermostatID: string | number): string {
    return `C${controllerID}_T${thermostatID}`;
  }
}
