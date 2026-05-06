import { Driver } from 'homey';
import { PairSession } from 'homey/lib/Driver';
import { Thermostat, UponorHTTPClient } from '../../lib/UponorHTTPClient';
import UponorThermostatDevice from './device';
import {
  CUSTOM_IP_ADDRESS_SETTINGS_KEY,
  DEBUG_DEVICES_SETTINGS_KEY,
  LIST_DEVICES_PAIR_KEY,
  CUSTOM_IP_ADDRESS_PAIR_KEY,
} from '../../lib/constants';

export class UponorDriver extends Driver {

  private _clients: Map<string, UponorHTTPClient> = new Map();

  getClient(address: string): UponorHTTPClient {
    if (!address) throw new Error('IP address is required to get a client');
    if (!this._clients.has(address)) {
      this._clients.set(address, new UponorHTTPClient(address));
    }
    return this._clients.get(address)!;
  }

  removeClient(address: string): void {
    this._clients.delete(address);
  }

  getCustomIpAddress(): string | undefined {
    return this.homey.settings.get(CUSTOM_IP_ADDRESS_SETTINGS_KEY);
  }

  private async _setCustomIpAddress(address: string): Promise<void> {
    return this.homey.settings.set(CUSTOM_IP_ADDRESS_SETTINGS_KEY, address);
  }

  async onInit(): Promise<void> {
    const isHeatingCondition = this.homey.flow.getConditionCard('thermostat_is_heating');
    if (isHeatingCondition) {
      isHeatingCondition.registerRunListener(async (args: { device: UponorThermostatDevice }, _state: any) => {
        return args.device.isHeating();
      });
    }

    const setSysEcoModeAction = this.homey.flow.getActionCard('device_set_sys_eco_mode');
    if (setSysEcoModeAction) {
      setSysEcoModeAction.registerRunListener(async (args: { device: UponorThermostatDevice, enabled: boolean }, _state: any) => {
        return args.device.getClient().setGlobalEcoMode(args.enabled);
      });
    }

    const isSysEcoModeCondition = this.homey.flow.getConditionCard('device_sys_eco_mode_is');
    if (isSysEcoModeCondition) {
      isSysEcoModeCondition.registerRunListener(async (args: { device: UponorThermostatDevice }, _state: any) => {
        // Ensuring we have the latest state
        await args.device.getClient().syncAttributes();
        return args.device.getClient().getGlobalEcoMode();
      });
    }

    const setSysHeatCoolModeAction = this.homey.flow.getActionCard('device_set_sys_heat_cool_mode');
    if (setSysHeatCoolModeAction) {
      setSysHeatCoolModeAction.registerRunListener(async (args: { device: UponorThermostatDevice, mode: 'heat' | 'cool' }, _state: any) => {
        return args.device.getClient().setGlobalHeatCoolMode(args.mode);
      });
    }

    const isSysHeatCoolModeCondition = this.homey.flow.getConditionCard('device_sys_heat_cool_mode_is');
    if (isSysHeatCoolModeCondition) {
      isSysHeatCoolModeCondition.registerRunListener(async (args: { device: UponorThermostatDevice, mode: 'heat' | 'cool' }, _state: any) => {
        await args.device.getClient().syncAttributes();
        return args.device.getClient().getGlobalHeatCoolMode() === args.mode;
      });
    }
  }

  async onPair(session: PairSession): Promise<void> {
    this.homey.settings.unset(CUSTOM_IP_ADDRESS_SETTINGS_KEY);
    session.setHandler(CUSTOM_IP_ADDRESS_PAIR_KEY, this._setCustomIpAddress.bind(this));
    session.setHandler(LIST_DEVICES_PAIR_KEY, this._listDevices.bind(this));
  }

  private async _listDevices(): Promise<unknown[]> {
    // when a custom IP address is set, only return devices for that address
    const customAddress = this.getCustomIpAddress();
    if (customAddress) {
      return this._findDevices(customAddress, `custom_${new Date().getTime()}`);
    }

    // otherwise discover devices on the network and use the all found ones
    const discoveryStrategy = this.getDiscoveryStrategy();
    const discoveryResults = discoveryStrategy.getDiscoveryResults();
    const controllers = Object.values(discoveryResults);

    if (controllers.length === 0) return [];

    const allDevicesPromises = controllers.map((controller) => this._findDevices(controller.address, controller.id));

    const allDevices = await Promise.all(allDevicesPromises);
    return allDevices.flat();
  }

  private async _findDevices(address: string, systemID: string): Promise<unknown[]> {
    try {
      const client = this.getClient(address);
      const success = await client.updateAddress(address);
      if (!success) throw new Error(`Could not connect to Uponor controller at IP address ${address}`);
      await client.syncAttributes();
      const debug = await client.debug();
      this.homey.settings.set(DEBUG_DEVICES_SETTINGS_KEY, JSON.stringify(debug));
      const thermostats = Array.from(client.getThermostats().values());
      return thermostats.map(this._mapDevice.bind(this, address, systemID));
    } catch (error) {
      this.homey.error(error);
      return [];
    }
  }

  private _mapDevice(address: string, systemID: string, thermostat: Thermostat): unknown {
    return {
      name: thermostat.name,
      data: {
        id: `${systemID}_${thermostat.id}`,
        controllerID: thermostat.controllerID,
        thermostatID: thermostat.thermostatID,
      },
      store: {
        address,
      },
    };
  }
}

module.exports = UponorDriver;
