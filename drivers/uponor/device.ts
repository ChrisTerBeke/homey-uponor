import { Device, DiscoveryResultMAC } from 'homey';
import { UponorHTTPClient } from '../../lib/UponorHTTPClient';
import { UponorDriver } from './driver';
import {
  MEASURE_TEMPERATURE_CAPABILITY, MEASURE_TEMPERATURE_MANIFOLD_HEAD_CAPABILITY, TARGET_TEMPERATURE_CAPABILITY, MEASURE_HUMIDITY_CAPABILITY, IS_HEATING_CAPABILITY, BYPASS_ENABLED_CAPABILITY, ECO_MODE_CAPABILITY, VALVE_POS_PERCENT_CAPABILITY, POLL_INTERVAL_MS, INIT_TIMEOUT_MS,
  ALARM_BATTERY_CAPABILITY, ALARM_TAMPER_CAPABILITY, ALARM_AIR_SENSOR_CAPABILITY, ALARM_EXT_SENSOR_CAPABILITY,
  ALARM_RH_SENSOR_CAPABILITY, ALARM_RF_ERROR_CAPABILITY, ALARM_RF_LOW_SIG_CAPABILITY, ALARM_VALVE_POS_CAPABILITY,
  ALARM_HEAT_FALLBACK_CAPABILITY,
} from '../../lib/constants';

class UponorThermostatDevice extends Device {

  private _isHeating: boolean = false;

  public isHeating(): boolean {
    return this._isHeating;
  }

  async onInit(): Promise<void> {
    await this._syncCapabilities();
    this.homey.setInterval(this._syncAttributes.bind(this), POLL_INTERVAL_MS);
    this.homey.setTimeout(this._syncAttributes.bind(this), INIT_TIMEOUT_MS);
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
    await this._ensureCapability(MEASURE_TEMPERATURE_MANIFOLD_HEAD_CAPABILITY);
    await this._ensureCapability(TARGET_TEMPERATURE_CAPABILITY, this._setTargetTemperature.bind(this));
    await this._ensureCapability(MEASURE_HUMIDITY_CAPABILITY);
    await this._ensureCapability(IS_HEATING_CAPABILITY);
    await this._ensureCapability(BYPASS_ENABLED_CAPABILITY);
    await this._ensureCapability(ECO_MODE_CAPABILITY, this._setEcoMode.bind(this));
    await this._ensureCapability(VALVE_POS_PERCENT_CAPABILITY);
    await this._ensureCapability(ALARM_BATTERY_CAPABILITY);
    await this._ensureCapability(ALARM_TAMPER_CAPABILITY);
    await this._ensureCapability(ALARM_AIR_SENSOR_CAPABILITY);
    await this._ensureCapability(ALARM_EXT_SENSOR_CAPABILITY);
    await this._ensureCapability(ALARM_RH_SENSOR_CAPABILITY);
    await this._ensureCapability(ALARM_RF_ERROR_CAPABILITY);
    await this._ensureCapability(ALARM_RF_LOW_SIG_CAPABILITY);
    await this._ensureCapability(ALARM_VALVE_POS_CAPABILITY);
    await this._ensureCapability(ALARM_HEAT_FALLBACK_CAPABILITY);
  }

  private async _ensureCapability(capability: string, callback: Device.CapabilityCallback | undefined = undefined): Promise<void> {
    if (!this.hasCapability(capability)) await this.addCapability(capability);
    if (callback) this.registerCapabilityListener(capability, callback);
  }

  private async _syncAttributes(): Promise<void> {
    try {
      await this.getClient().syncAttributes();
      const { controllerID, thermostatID } = this.getData();
      const data = this.getClient().getThermostat(controllerID, thermostatID);
      if (!data) {
        await this.setUnavailable('Could not find thermostat data');
        return;
      }
      await this.setAvailable();
      await this.setCapabilityValue(MEASURE_TEMPERATURE_CAPABILITY, data.temperature);
      if (data.manifoldHeadTemperature !== undefined) {
        await this.setCapabilityValue(MEASURE_TEMPERATURE_MANIFOLD_HEAD_CAPABILITY, data.manifoldHeadTemperature);
      }
      
      if (this.hasCapability(TARGET_TEMPERATURE_CAPABILITY)) {
        const currentOptions = this.getCapabilityOptions(TARGET_TEMPERATURE_CAPABILITY) || {};
        const shouldUpdateMin = data.minimumSetPoint !== undefined && currentOptions.min !== data.minimumSetPoint;
        const shouldUpdateMax = data.maximumSetPoint !== undefined && currentOptions.max !== data.maximumSetPoint;

        if (shouldUpdateMin || shouldUpdateMax) {
          await this.setCapabilityOptions(TARGET_TEMPERATURE_CAPABILITY, {
            min: data.minimumSetPoint ?? currentOptions.min,
            max: data.maximumSetPoint ?? currentOptions.max,
          });
        }

        await this.setCapabilityValue(TARGET_TEMPERATURE_CAPABILITY, data.setPoint);
      }

      if (data.humidity !== undefined) {
        await this.setCapabilityValue(MEASURE_HUMIDITY_CAPABILITY, data.humidity);
      }
      this._isHeating = data.active;
      await this.setCapabilityValue(IS_HEATING_CAPABILITY, data.active);
      await this.setCapabilityValue(BYPASS_ENABLED_CAPABILITY, data.bypassEnabled);
      await this.setCapabilityValue(ECO_MODE_CAPABILITY, data.ecoMode);
      if (data.valvePosPercent !== undefined) {
        await this.setCapabilityValue(VALVE_POS_PERCENT_CAPABILITY, data.valvePosPercent);
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
    } catch (error) {
      this.homey.error(error);
      await this.setUnavailable('Could not fetch data from Uponor controller');
    }
  }

  private async _setTargetTemperature(value: number, _opts: unknown): Promise<void> {
    const { controllerID, thermostatID } = this.getData();
    try {
      await this.getClient().setTargetTemperature(controllerID, thermostatID, value);
    } catch (error) {
      this.homey.error(error);
      await this.setUnavailable('Could not send data to Uponor controller');
      throw error; // Rethrow so Homey UI reverts
    }
  }

  private async _setEcoMode(value: boolean, _opts: unknown): Promise<void> {
    const { controllerID, thermostatID } = this.getData();
    try {
      await this.getClient().setThermostatEcoMode(controllerID, thermostatID, value);
    } catch (error) {
      this.homey.error(error);
      await this.setUnavailable('Could not send data to Uponor controller');
      throw error;
    }
  }
}

export default UponorThermostatDevice;
module.exports = UponorThermostatDevice;
