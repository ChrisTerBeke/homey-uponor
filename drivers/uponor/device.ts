import { Device, DiscoveryResultMAC } from 'homey';
import { UponorHTTPClient } from '../../lib/UponorHTTPClient';
import { UponorDriver } from './driver';
import {
  MEASURE_TEMPERATURE_CAPABILITY, TARGET_TEMPERATURE_CAPABILITY, POLL_INTERVAL_MS, INIT_TIMEOUT_MS,
} from '../../lib/constants';

class UponorThermostatDevice extends Device {

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

  private _getClient(): UponorHTTPClient {
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
  }

  private async _ensureCapability(capability: string, callback: Device.CapabilityCallback | undefined = undefined): Promise<void> {
    if (!this.hasCapability(capability)) await this.addCapability(capability);
    if (callback) this.registerCapabilityListener(capability, callback);
  }

  private async _syncAttributes(): Promise<void> {
    try {
      await this._getClient().syncAttributes();
      const { controllerID, thermostatID } = this.getData();
      const data = this._getClient().getThermostat(controllerID, thermostatID);
      if (!data) {
        await this.setUnavailable('Could not find thermostat data');
        return;
      }
      await this.setAvailable();
      await this.setCapabilityValue(MEASURE_TEMPERATURE_CAPABILITY, data.temperature);
      await this.setCapabilityValue(TARGET_TEMPERATURE_CAPABILITY, data.setPoint);
    } catch (error) {
      this.homey.error(error);
      await this.setUnavailable('Could not fetch data from Uponor controller');
    }
  }

  private async _setTargetTemperature(value: number, _opts: unknown): Promise<void> {
    const { controllerID, thermostatID } = this.getData();
    try {
      await this._getClient().setTargetTemperature(controllerID, thermostatID, value);
    } catch (error) {
      this.homey.error(error);
      await this.setUnavailable('Could not send data to Uponor controller');
      throw error; // Rethrow so Homey UI reverts
    }
  }
}

module.exports = UponorThermostatDevice;
