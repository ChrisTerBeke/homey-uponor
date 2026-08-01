import Homey from 'homey';
import type { DiscoveryResultMAC } from 'homey';
import { UponorHTTPClient } from '../../lib/UponorHTTPClient.mjs';
import { UponorDriver } from './driver.mjs';
import {
  MEASURE_TEMPERATURE_CAPABILITY, MEASURE_TEMPERATURE_MANIFOLD_HEAD_CAPABILITY,
  MEASURE_TEMPERATURE_FLOOR_CAPABILITY, MEASURE_TEMPERATURE_FLOOR_MIN_CAPABILITY, MEASURE_TEMPERATURE_FLOOR_MAX_CAPABILITY,
  TARGET_TEMPERATURE_CAPABILITY, MEASURE_HUMIDITY_CAPABILITY,
  IS_HEATING_CAPABILITY, BYPASS_ENABLED_CAPABILITY, ECO_MODE_CAPABILITY,
  THERMOSTAT_MODE_CAPABILITY, VALVE_POS_PERCENT_CAPABILITY,
  ALARM_BATTERY_CAPABILITY, ALARM_TAMPER_CAPABILITY, ALARM_AIR_SENSOR_CAPABILITY, ALARM_EXT_SENSOR_CAPABILITY,
  ALARM_RH_SENSOR_CAPABILITY, ALARM_RF_ERROR_CAPABILITY, ALARM_RF_LOW_SIG_CAPABILITY, ALARM_VALVE_POS_CAPABILITY,
  ALARM_HEAT_FALLBACK_CAPABILITY, ALARM_FLOOR_LIMIT_CAPABILITY, SYS_SUPPLY_DIAGNOSTIC_CAPABILITY, ALARM_GENERAL_SYSTEM_CAPABILITY,
} from '../../lib/constants.mjs';

class UponorThermostatDevice extends Homey.Device {

  private _isHeating: boolean = false;

  public isHeating(): boolean {
    return this._isHeating;
  }

  async onInit(): Promise<void> {
    await this._syncCapabilities();

    // Clean up deprecated capabilities from previously paired devices
    const deprecatedCapabilities = [
      'measure_temperature.average',
      'measure_humidity.average',
      'alarm_generic.sys_supply_diagnostic',
    ];

    for (const cap of deprecatedCapabilities) {
      if (this.hasCapability(cap)) {
        try {
          await this.removeCapability(cap);
          this.homey.log(`Removed deprecated capability ${cap}`);
        } catch (err) {
          this.homey.error(`Failed to remove deprecated capability ${cap}:`, err);
        }
      }
    }

    if (this.driver && typeof (this.driver as any).startPolling === 'function') {
      (this.driver as UponorDriver).startPolling();
    }

    // Ensure this device gets initial data populated immediately
    try {
      await this.getClient().syncAttributes();
      await this.updateData();
    } catch (error) {
      this.homey.error('Initial device sync failed:', error);
    }
  }

  async onDeleted(): Promise<void> {
    (this.driver as UponorDriver).checkPollingStatus();
  }

  async onUninit(): Promise<void> {
    (this.driver as UponorDriver).checkPollingStatus();
  }

  onDiscoveryResult(discoveryResult: DiscoveryResultMAC): boolean {
    return this.getData().id.includes(discoveryResult.id);
  }

  async onDiscoveryAvailable(discoveryResult: DiscoveryResultMAC): Promise<void> {
    await this._updateAddress(discoveryResult.address);
  }

  async onDiscoveryAddressChanged(discoveryResult: DiscoveryResultMAC): Promise<void> {
    await this._updateAddress(discoveryResult.address);
  }

  async onRenamed(name: string): Promise<void> {
    const { controllerID, thermostatID } = this.getData();
    try {
      await this.getClient().setThermostatName(controllerID, thermostatID, name);
    } catch (error) {
      this.homey.error('Could not rename device on controller', error);
      throw new Error('Could not rename device on controller');
    }
  }

  public getClient(): UponorHTTPClient {
    const address = this.getStoreValue('address');
    if (!address) throw new Error('IP address not set in store');
    const driver = this.driver as UponorDriver;
    return driver.getClient(address);
  }

  private async _updateAddress(newAddress: string): Promise<boolean> {
    const oldAddress = this.getStoreValue('address');
    if (oldAddress === newAddress) return true;

    const driver = this.driver as UponorDriver;
    const testClient = driver.getClient(newAddress);

    // Only save the new address if the controller is actually reachable there
    const success = await testClient.testConnection();
    if (success) {
      if (oldAddress) {
        driver.removeClient(oldAddress);
      }
      await this.setStoreValue('address', newAddress);
    }
    return success;
  }

  private async _syncCapabilities(): Promise<void> {
    await this._ensureCapability(MEASURE_TEMPERATURE_CAPABILITY);
    await this._ensureCapability(TARGET_TEMPERATURE_CAPABILITY, this._setTargetTemperature.bind(this));
    await this._ensureCapability(IS_HEATING_CAPABILITY);
    await this._ensureCapability(BYPASS_ENABLED_CAPABILITY);

    if (this.hasCapability(ECO_MODE_CAPABILITY)) {
      await this.removeCapability(ECO_MODE_CAPABILITY);
    }
    await this._ensureCapability(THERMOSTAT_MODE_CAPABILITY, this._setThermostatMode.bind(this));
    await this._ensureCapability(SYS_SUPPLY_DIAGNOSTIC_CAPABILITY);
    await this._ensureCapability(ALARM_GENERAL_SYSTEM_CAPABILITY);

    await this._ensureCapability(ALARM_BATTERY_CAPABILITY);
    await this._ensureCapability(ALARM_TAMPER_CAPABILITY);
    await this._ensureCapability(ALARM_AIR_SENSOR_CAPABILITY);
    await this._ensureCapability(ALARM_EXT_SENSOR_CAPABILITY);
    await this._ensureCapability(ALARM_RH_SENSOR_CAPABILITY);
    await this._ensureCapability(ALARM_RF_ERROR_CAPABILITY);
    await this._ensureCapability(ALARM_RF_LOW_SIG_CAPABILITY);
    await this._ensureCapability(ALARM_VALVE_POS_CAPABILITY);
    await this._ensureCapability(ALARM_HEAT_FALLBACK_CAPABILITY);
    await this._ensureCapability(ALARM_FLOOR_LIMIT_CAPABILITY);
  }

  private async _ensureCapability(capability: string, callback: any | undefined = undefined): Promise<void> {
    if (!this.hasCapability(capability)) await this.addCapability(capability);
    // Homey Devices don't have a built-in hasCapabilityListener that is public or typesafe enough
    if (callback) {
      try {
        this.registerCapabilityListener(capability, callback);
      } catch (err) {
        // Ignore if already registered
      }
    }
  }

  private async _removeCapabilityIfExists(capability: string): Promise<void> {
    if (this.hasCapability(capability)) {
      await this.removeCapability(capability);
    }
  }

  public async updateData(): Promise<void> {
    try {
      const { controllerID, thermostatID } = this.getData();
      const data = this.getClient().getThermostat(controllerID, thermostatID);
      if (!data) {
        await this.setUnavailable('Could not find thermostat data');
        return;
      }
      await this.setAvailable();

      await this.setCapabilityValue(MEASURE_TEMPERATURE_CAPABILITY, data.temperature);

      if (data.manifoldHeadTemperature !== undefined) {
        await this._ensureCapability(MEASURE_TEMPERATURE_MANIFOLD_HEAD_CAPABILITY);
        await this.setCapabilityValue(MEASURE_TEMPERATURE_MANIFOLD_HEAD_CAPABILITY, data.manifoldHeadTemperature);
      } else {
        await this._removeCapabilityIfExists(MEASURE_TEMPERATURE_MANIFOLD_HEAD_CAPABILITY);
      }

      if (data.floorTemperature !== undefined) {
        await this._ensureCapability(MEASURE_TEMPERATURE_FLOOR_CAPABILITY);
        await this.setCapabilityValue(MEASURE_TEMPERATURE_FLOOR_CAPABILITY, data.floorTemperature);
      } else {
        await this._removeCapabilityIfExists(MEASURE_TEMPERATURE_FLOOR_CAPABILITY);
      }

      if (data.minimumFloorSetPoint !== undefined) {
        await this._ensureCapability(MEASURE_TEMPERATURE_FLOOR_MIN_CAPABILITY);
        await this.setCapabilityValue(MEASURE_TEMPERATURE_FLOOR_MIN_CAPABILITY, data.minimumFloorSetPoint);
      } else {
        await this._removeCapabilityIfExists(MEASURE_TEMPERATURE_FLOOR_MIN_CAPABILITY);
      }

      if (data.maximumFloorSetPoint !== undefined) {
        await this._ensureCapability(MEASURE_TEMPERATURE_FLOOR_MAX_CAPABILITY);
        await this.setCapabilityValue(MEASURE_TEMPERATURE_FLOOR_MAX_CAPABILITY, data.maximumFloorSetPoint);
      } else {
        await this._removeCapabilityIfExists(MEASURE_TEMPERATURE_FLOOR_MAX_CAPABILITY);
      }

      if (this.hasCapability(TARGET_TEMPERATURE_CAPABILITY)) {
        let currentOptions: any = {};
        try {
          currentOptions = this.getCapabilityOptions(TARGET_TEMPERATURE_CAPABILITY) || {};
        } catch (err) {
          // getCapabilityOptions can throw if options are not yet initialized or undefined in the manifest
          currentOptions = {};
        }

        const shouldUpdateMin = data.minimumSetPoint !== undefined && currentOptions.min !== data.minimumSetPoint;
        const shouldUpdateMax = data.maximumSetPoint !== undefined && currentOptions.max !== data.maximumSetPoint;

        if (shouldUpdateMin || shouldUpdateMax) {
          await this.setCapabilityOptions(TARGET_TEMPERATURE_CAPABILITY, {
            min: data.minimumSetPoint,
            max: data.maximumSetPoint,
          }).catch((err) => this.homey.error('Failed to set capability options', err));
        }

        await this.setCapabilityValue(TARGET_TEMPERATURE_CAPABILITY, data.setPoint);
      }

      if (data.humidity !== undefined) {
        await this._ensureCapability(MEASURE_HUMIDITY_CAPABILITY);
        await this.setCapabilityValue(MEASURE_HUMIDITY_CAPABILITY, data.humidity);
      } else {
        await this._removeCapabilityIfExists(MEASURE_HUMIDITY_CAPABILITY);
      }

      this._isHeating = data.active;
      await this.setCapabilityValue(IS_HEATING_CAPABILITY, data.active);
      await this.setCapabilityValue(BYPASS_ENABLED_CAPABILITY, data.bypassEnabled);

      const isHoliday = this.getClient().getGlobalEcoMode();
      let currentMode = data.mode;
      if (isHoliday) {
        currentMode = 'holiday';
      } else if (data.ecoMode) {
        currentMode = 'eco';
      }

      await this.setCapabilityValue(THERMOSTAT_MODE_CAPABILITY, currentMode);

      if (data.valvePosPercent !== undefined) {
        await this._ensureCapability(VALVE_POS_PERCENT_CAPABILITY);
        await this.setCapabilityValue(VALVE_POS_PERCENT_CAPABILITY, data.valvePosPercent);
      } else {
        await this._removeCapabilityIfExists(VALVE_POS_PERCENT_CAPABILITY);
      }

      await this.setCapabilityValue(ALARM_BATTERY_CAPABILITY, data.alarms.battery);
      await this.setCapabilityValue(ALARM_TAMPER_CAPABILITY, data.alarms.tamper);
      await this.setCapabilityValue(ALARM_AIR_SENSOR_CAPABILITY, data.alarms.airSensor);
      await this.setCapabilityValue(ALARM_EXT_SENSOR_CAPABILITY, data.alarms.extSensor);
      await this.setCapabilityValue(ALARM_RH_SENSOR_CAPABILITY, data.alarms.rhSensor);
      await this.setCapabilityValue(ALARM_RF_ERROR_CAPABILITY, data.alarms.rfError);
      await this.setCapabilityValue(ALARM_RF_LOW_SIG_CAPABILITY, data.alarms.rfLowSig);
      await this.setCapabilityValue(ALARM_VALVE_POS_CAPABILITY, data.alarms.valvePos);
      await this.setCapabilityValue(ALARM_HEAT_FALLBACK_CAPABILITY, data.alarms.heatFallback);
      await this.setCapabilityValue(ALARM_FLOOR_LIMIT_CAPABILITY, data.alarms.floorLimit);

      const metrics = this.getClient().getSystemMetrics(controllerID);
      await this.setCapabilityValue(ALARM_GENERAL_SYSTEM_CAPABILITY, metrics.generalSystemAlarm);

      const alarmStr = this.getClient().getAttribute('sys_supply_diagnostic');
      if (alarmStr !== undefined) {
        await this.setCapabilityValue(SYS_SUPPLY_DIAGNOSTIC_CAPABILITY, alarmStr === '1');
      }

      // Dynamically update cooling capability options based on cooling availability and thermostat settings
      if (this.hasCapability(THERMOSTAT_MODE_CAPABILITY)) {
        const isCoolingSupported = metrics.coolingAvailable && (data.coolingAllowed ?? true);
        let currentOptions: any = {};
        try {
          currentOptions = this.getCapabilityOptions(THERMOSTAT_MODE_CAPABILITY) || {};
        } catch (err) {
          // getCapabilityOptions can throw if options are not yet initialized or undefined in the manifest
          currentOptions = {};
        }
        const hasCoolOption = currentOptions.values?.some((v: any) => v.id === 'cool');

        if (!isCoolingSupported) {
          if (hasCoolOption === undefined || hasCoolOption) {
            await this.setCapabilityOptions(THERMOSTAT_MODE_CAPABILITY, {
              values: [
                { id: 'heat', title: { en: 'Heating', nl: 'Verwarmen' } },
                { id: 'eco', title: { en: 'Eco', nl: 'Eco' } },
                { id: 'holiday', title: { en: 'Holiday', nl: 'Vakantie' } },
              ],
            }).catch((err) => this.homey.error('Failed to update thermostat mode options', err));
          }
        } else if (hasCoolOption === false) {
          await this.setCapabilityOptions(THERMOSTAT_MODE_CAPABILITY, {
            values: [
              { id: 'heat', title: { en: 'Heating', nl: 'Verwarmen' } },
              { id: 'cool', title: { en: 'Cooling', nl: 'Koelen' } },
              { id: 'eco', title: { en: 'Eco', nl: 'Eco' } },
              { id: 'holiday', title: { en: 'Holiday', nl: 'Vakantie' } },
            ],
          }).catch((err) => this.homey.error('Failed to update thermostat mode options', err));
        }
      }
    } catch (error) {
      this.homey.error(error);
      await this.setUnavailable('Could not fetch data from Uponor controller');
    }
  }

  private _targetTemperatureDebounce?: any;
  private _targetTemperatureValue?: number;

  private async _setTargetTemperature(value: number, _opts: unknown): Promise<void> {
    const { controllerID, thermostatID } = this.getData();
    this._targetTemperatureValue = value;

    // Acknowledge the value to Homey immediately to prevent the mobile app from bouncing/rubber-banding.
    this.setCapabilityValue(TARGET_TEMPERATURE_CAPABILITY, value).catch((err) => this.homey.error(err));

    if (this._targetTemperatureDebounce) {
      this.homey.clearTimeout(this._targetTemperatureDebounce);
    }

    this._targetTemperatureDebounce = this.homey.setTimeout(async () => {
      this._targetTemperatureDebounce = undefined;

      try {
        const finalValue = this._targetTemperatureValue!;
        await this.getClient().setTargetTemperature(controllerID, thermostatID, finalValue);
      } catch (error) {
        this.homey.error('Failed to set target temperature', error);
        this.setUnavailable('Could not send data to Uponor controller').catch(() => {});
        // Optionally revert UI here by fetching cached value
        try {
          const thermostat = this.getClient().getThermostat(controllerID, thermostatID);
          if (thermostat && thermostat.setPoint !== undefined) {
            await this.setCapabilityValue(TARGET_TEMPERATURE_CAPABILITY, thermostat.setPoint);
          }
        } catch (e) {}
      }
    }, 500); // 500ms debounce

    // Resolve immediately so Homey UI does not time out and cause rubber-banding
    return Promise.resolve();
  }

  private async _setThermostatMode(value: string, _opts: unknown): Promise<void> {
    const { controllerID, thermostatID } = this.getData();

    // Optimistic UI update
    this.setCapabilityValue(THERMOSTAT_MODE_CAPABILITY, value).catch((err) => this.homey.error(err));

    try {
      if (value === 'heat') {
        await this.getClient().setGlobalHeatCoolMode('heat');
        await this.getClient().setGlobalEcoMode(false);
        await this.getClient().setThermostatEcoMode(controllerID, thermostatID, false);
      } else if (value === 'cool') {
        await this.getClient().setGlobalHeatCoolMode('cool');
        await this.getClient().setGlobalEcoMode(false);
        await this.getClient().setThermostatEcoMode(controllerID, thermostatID, false);
      } else if (value === 'eco') {
        await this.getClient().setGlobalEcoMode(false);
        await this.getClient().setThermostatEcoMode(controllerID, thermostatID, true);
      } else if (value === 'holiday') {
        await this.getClient().setGlobalEcoMode(true);
      }
    } catch (error) {
      this.homey.error('Failed to set thermostat mode', error);
      // Let the next poll fix the UI if it failed
    }

    // Resolve immediately to prevent UI rubber-banding
    return Promise.resolve();
  }
}

export default UponorThermostatDevice;
