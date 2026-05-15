import Homey from 'homey';
import type { UponorDriver } from './drivers/uponor/driver.mjs';

class UponorApp extends Homey.App {
  async onInit() {
    this.log('UponorApp is running...');
  }

  async getWidgetDevices() {
    // This method will be called by the widget API to get the current state of devices
    const driver = this.homey.drivers.getDriver('uponor') as UponorDriver;
    const devices = driver.getDevices();
    
    return devices.map(device => {
      // safely cast device since driver 'getDevices' returns generic Device[]
      const dev = device as any;
      const data = dev.getData();
      const cId = data.controllerID || 1;
      
      return {
        id: dev.id || device.getName(),
        name: device.getName(),
        zoneName: device.getName(),
        controllerID: cId,
        controllerName: `Controller ${cId}`,
        thermostatID: data.thermostatID || 1,
        measure_temperature: device.getCapabilityValue('measure_temperature'),
        target_temperature: device.getCapabilityValue('target_temperature'),
        manifold_temp: device.hasCapability('measure_temperature.manifold_head') ? device.getCapabilityValue('measure_temperature.manifold_head') : null,
        measure_humidity: device.hasCapability('measure_humidity') ? device.getCapabilityValue('measure_humidity') : null,
        is_heating: device.getCapabilityValue('is_heating'),
        thermostat_mode: device.getCapabilityValue('thermostat_mode'),
        eco_mode: device.hasCapability('eco_mode') ? device.getCapabilityValue('eco_mode') : false,
        bypass_enabled: device.getCapabilityValue('bypass_enabled'),
        valve_pos: device.getCapabilityValue('valve_pos_percent'),
        alarm_battery: device.hasCapability('alarm_battery') ? device.getCapabilityValue('alarm_battery') : false,
        alarm_tamper: device.hasCapability('alarm_tamper') ? device.getCapabilityValue('alarm_tamper') : false,
        alarm_air: device.hasCapability('alarm_generic.air_sensor') ? device.getCapabilityValue('alarm_generic.air_sensor') : false,
        alarm_ext: device.hasCapability('alarm_generic.ext_sensor') ? device.getCapabilityValue('alarm_generic.ext_sensor') : false,
        alarm_rh: device.hasCapability('alarm_generic.rh_sensor') ? device.getCapabilityValue('alarm_generic.rh_sensor') : false,
        alarm_rf: device.hasCapability('alarm_generic.rf_error') ? device.getCapabilityValue('alarm_generic.rf_error') : false,
        alarm_rf_low: device.hasCapability('alarm_generic.rf_low_sig') ? device.getCapabilityValue('alarm_generic.rf_low_sig') : false,
        alarm_valve: device.hasCapability('alarm_generic.valve_pos') ? device.getCapabilityValue('alarm_generic.valve_pos') : false,
        alarm_heat_fallback: device.hasCapability('alarm_generic.heat_fallback') ? device.getCapabilityValue('alarm_generic.heat_fallback') : false,
        sys_supply_diagnostic: device.hasCapability('sys_supply_diagnostic') ? device.getCapabilityValue('sys_supply_diagnostic') : false,
        alarm_system: device.hasCapability('alarm_generic.system') ? device.getCapabilityValue('alarm_generic.system') : false,
      };
    });
  }

  async getWidgetStats() {
    const driver = this.homey.drivers.getDriver('uponor') as UponorDriver;
    const allDevices = driver.getDevices();
    
    let globalData = {};
    const formattedDevices = [];

    if (allDevices.length > 0) {
      try {
        const firstDev = allDevices[0] as any;
        const address = firstDev.getStoreValue('address');
        if (address) {
          const client = driver.getClient(address);
          
          let outdoorTemp = null;
          const rawOutdoor = client.getAttribute('Sys_ext_outdoor_temp');
          // 32767 usually means no sensor connected in Uponor hardware
          if (rawOutdoor && rawOutdoor !== '32767') {
              // Usually sent in deci-celsius or fahrenheit depending on locale, Assuming F -> C logic based on API wrapper
              const parsed = parseInt(rawOutdoor, 10);
              if (!isNaN(parsed) && parsed !== 32767) {
                 outdoorTemp = ((parsed / 10) - 32) * (5 / 9); // Assuming raw is deci-fahrenheit like setpoints
              }
          }

          const hasUpdate = client.getAttribute('cust_SW_version_update') === '1';

          const controllersData: Record<number, any> = {};
          
          for (const device of allDevices) {
            const dev = device as any;
            const data = dev.getData();
            const cId = data.controllerID || 1;
            
            if (!controllersData[cId]) {
              const parseTemp = (val: string | undefined) => {
                if (!val || val === '32767') return null;
                const parsed = parseInt(val, 10);
                if (isNaN(parsed)) return null;
                return ((parsed / 10) - 32) * (5 / 9);
              };

              controllersData[cId] = {
                id: cId,
                name: client.getControllerName(cId),
                supplyTemp: parseTemp(client.getAttribute(`C${cId}_supply_temperature`)),
                pumpRelay: client.getAttribute(`C${cId}_stat_pump_relay`) === '1',
                demand: client.getAttribute(`C${cId}_stat_demand`) === '1',
                swVersion: client.getAttribute(`C${cId}_sw_version`),
                alarmSupplyHigh: client.getAttribute(`C${cId}_stat_supply_temp_hi_alarm`) === '1',
                alarmSupplyLow: client.getAttribute(`C${cId}_stat_supply_temp_low_alarm`) === '1',
                alarmGeneral: client.getAttribute(`C${cId}_stat_general_system_alarm`) === '1'
              };
            }

            formattedDevices.push({
              id: dev.id || device.getName(),
              name: device.getName(),
              zoneName: device.getName(),
              controllerID: cId,
              controllerName: client.getControllerName(cId),
              thermostatID: data.thermostatID || 1,
              measure_temperature: device.getCapabilityValue('measure_temperature'),
              target_temperature: device.getCapabilityValue('target_temperature'),
              min_temperature: client.getAttribute(`C${cId}_T${data.thermostatID || 1}_minimum_setpoint`) ? 
                    (((parseInt(client.getAttribute(`C${cId}_T${data.thermostatID || 1}_minimum_setpoint`)!, 10) / 10) - 32) * (5/9)) : 5,
              max_temperature: client.getAttribute(`C${cId}_T${data.thermostatID || 1}_maximum_setpoint`) ? 
                    (((parseInt(client.getAttribute(`C${cId}_T${data.thermostatID || 1}_maximum_setpoint`)!, 10) / 10) - 32) * (5/9)) : 35,
              manifold_temp: device.hasCapability('measure_temperature.manifold_head') ? device.getCapabilityValue('measure_temperature.manifold_head') : null,
              measure_humidity: device.hasCapability('measure_humidity') ? device.getCapabilityValue('measure_humidity') : null,
              external_temp: client.getAttribute(`C${cId}_T${data.thermostatID || 1}_external_temperature`) && client.getAttribute(`C${cId}_T${data.thermostatID || 1}_external_temperature`) !== '32767' ? 
                    (((parseInt(client.getAttribute(`C${cId}_T${data.thermostatID || 1}_external_temperature`)!, 10) / 10) - 32) * (5/9)) : null,
              is_heating: device.getCapabilityValue('is_heating'),
              thermostat_mode: device.getCapabilityValue('thermostat_mode'),
              eco_mode: device.hasCapability('eco_mode') ? device.getCapabilityValue('eco_mode') : false,
              bypass_enabled: device.getCapabilityValue('bypass_enabled'),
              valve_pos: device.getCapabilityValue('valve_pos_percent'),
              alarm_battery: device.hasCapability('alarm_battery') ? device.getCapabilityValue('alarm_battery') : false,
              alarm_tamper: device.hasCapability('alarm_tamper') ? device.getCapabilityValue('alarm_tamper') : false,
              alarm_air: device.hasCapability('alarm_generic.air_sensor') ? device.getCapabilityValue('alarm_generic.air_sensor') : false,
              alarm_ext: device.hasCapability('alarm_generic.ext_sensor') ? device.getCapabilityValue('alarm_generic.ext_sensor') : false,
              alarm_rh: device.hasCapability('alarm_generic.rh_sensor') ? device.getCapabilityValue('alarm_generic.rh_sensor') : false,
              alarm_rf: device.hasCapability('alarm_generic.rf_error') ? device.getCapabilityValue('alarm_generic.rf_error') : false,
              alarm_rf_low: device.hasCapability('alarm_generic.rf_low_sig') ? device.getCapabilityValue('alarm_generic.rf_low_sig') : false,
              alarm_valve: device.hasCapability('alarm_generic.valve_pos') ? device.getCapabilityValue('alarm_generic.valve_pos') : false,
              alarm_heat_fallback: device.hasCapability('alarm_generic.heat_fallback') ? device.getCapabilityValue('alarm_generic.heat_fallback') : false,
              sys_supply_diagnostic: device.hasCapability('sys_supply_diagnostic') ? device.getCapabilityValue('sys_supply_diagnostic') : false,
              alarm_system: device.hasCapability('alarm_generic.system') ? device.getCapabilityValue('alarm_generic.system') : false,
            });
          }

          globalData = {
            ecoMode: client.getGlobalEcoMode(),
            heatCoolMode: client.getGlobalHeatCoolMode(),
            coolingAvailable: client.getAttribute('sys_cooling_available') === '1',
            autoBalance: client.getAttribute('sys_autobalance') === '1',
            averageHumidity: client.getAttribute('sys_average_relative_humidity'),
            metrics: client.getSystemMetrics(1),
            wifi: client.getWifiName(),
            outdoorTemp: outdoorTemp != null ? outdoorTemp : null,
            hasUpdate,
            controllers: controllersData
          };
          
          return { devices: formattedDevices, globalData };
        }
      } catch (e) {
        this.log('Failed to fetch global client data for widget', e);
      }
    }
    
    // Fallback if client access fails
    const devices = await this.getWidgetDevices();
    return { devices, globalData };
  }

  async setWidgetTemperature(deviceId: string, temperature: number): Promise<boolean> {
    const driver = this.homey.drivers.getDriver('uponor') as UponorDriver;
    const device = driver.getDevice({ id: deviceId });
    
    if (device) {
      try {
        await device.setCapabilityValue('target_temperature', temperature);
        // Also fire off the actual capability listener so it reaches the physical device
        await device.triggerCapabilityListener('target_temperature', temperature, {});
        return true;
      } catch (e) {
        this.error('Failed to set temperature via widget', e);
      }
    }
    return false;
  }
}

export default UponorApp;
