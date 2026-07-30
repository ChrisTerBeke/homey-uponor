import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import UponorThermostatDevice from '../drivers/uponor/device.mjs';
import { UponorHTTPClient } from '../lib/UponorHTTPClient.mjs';

// Mock the HTTP client so we don't make real network requests in device tests
vi.mock('../lib/UponorHTTPClient.mjs', function() {
  const UponorHTTPClientMock = vi.fn().mockImplementation(function() {
    return {
      syncAttributes: vi.fn(),
      getThermostat: vi.fn().mockReturnValue({
        id: 'C0_T0',
        controllerID: 0,
        thermostatID: 0,
        name: 'Living Room',
        temperature: 21.5,
        manifoldHeadTemperature: 22.0,
        setPoint: 21.0,
        minimumSetPoint: 5.0,
        maximumSetPoint: 35.0,
        mode: 'heat',
        humidity: 45,
        active: true,
        bypassEnabled: false,
        ecoMode: false,
        coolingAllowed: true,
        alarms: {
          battery: false,
          tamper: false,
          airSensor: false,
          extSensor: false,
          rhSensor: false,
          rfError: false,
          rfLowSig: false,
          valvePos: false,
          heatFallback: false,
        },
      }),
      getGlobalHeatCoolMode: vi.fn().mockReturnValue('heat'),
      getGlobalEcoMode: vi.fn().mockReturnValue(false),
      getSystemMetrics: vi.fn().mockReturnValue({ generalSystemAlarm: false, coolingAvailable: true }),
      getAttribute: vi.fn().mockReturnValue('0'),
      setTargetTemperature: vi.fn(),
      setThermostatEcoMode: vi.fn(),
      setGlobalHeatCoolMode: vi.fn(),
      setGlobalEcoMode: vi.fn(),
      updateAddress: vi.fn(),
      testConnection: vi.fn().mockResolvedValue(true),
    };
  });
  return {
    UponorHTTPClient: UponorHTTPClientMock,
  };
});

describe('UponorThermostatDevice', function() {
  let device: UponorThermostatDevice;

  beforeEach(function() {
    device = new UponorThermostatDevice();
    device.getStoreValue = vi.fn().mockImplementation((key) => {
      if (key === 'controllerID') return 0;
      if (key === 'thermostatID') return 0;
      if (key === 'address') return '192.168.1.100';
      return null;
    });

    device.getData = vi.fn().mockReturnValue({ id: 'C0_T0' });
    device.getCapabilityOptions = vi.fn().mockReturnValue(undefined);
    device.setCapabilityOptions = vi.fn().mockResolvedValue(undefined);
    device.setAvailable = vi.fn().mockResolvedValue(undefined);
    device.setCapabilityValue = vi.fn().mockResolvedValue(undefined);
    device.homey = {
      setInterval: vi.fn(),
      setTimeout: vi.fn(),
      clearInterval: vi.fn(),
      clearTimeout: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as any;

    // Mock driver access
    device.driver = {
      getClient: vi.fn().mockReturnValue(new UponorHTTPClient('1.2.3.4')),
      removeClient: vi.fn(),
      startPolling: vi.fn(),
      checkPollingStatus: vi.fn(),
    } as any;
  });

  it('should initialize and sync capabilities', async function() {
    // Need to mock hasCapability properly for init
    device.hasCapability = vi.fn().mockReturnValue(true);
    device.addCapability = vi.fn();
    device.registerCapabilityListener = vi.fn();

    await device.onInit();

    // Note: the test calls the internal `updateData` here directly because `onInit` delegates to the driver
    await device.updateData();

    expect((device.driver as any).startPolling).toHaveBeenCalled();
    expect(device.homey.error).not.toHaveBeenCalled();
    expect(device.setAvailable).toHaveBeenCalled();
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_temperature', 21.5);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_temperature', 21.0);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('is_heating', true);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('bypass_enabled', false);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('thermostat_mode', 'heat');
  });

  it('should cleanup polling on delete or uninit', async function() {
    device.hasCapability = vi.fn().mockReturnValue(true);
    device.addCapability = vi.fn();
    device.registerCapabilityListener = vi.fn();

    await device.onInit();
    expect((device.driver as any).startPolling).toHaveBeenCalled();

    await device.onUninit();
    expect((device.driver as any).checkPollingStatus).toHaveBeenCalled();

    // Call onDeleted and verify the same behaviour
    await device.onInit();
    await device.onDeleted();

    expect((device.driver as any).checkPollingStatus).toHaveBeenCalledTimes(2);
  });

  describe('capability listeners', function() {
    beforeEach(async function() {
      // Need to mock hasCapability properly for init
      device.hasCapability = vi.fn().mockReturnValue(true);
      device.addCapability = vi.fn();

      device.getStoreValue = vi.fn().mockImplementation((key) => {
        if (key === 'controllerID') return 0;
        if (key === 'thermostatID') return 0;
        if (key === 'address') return '192.168.1.100';
        return null;
      });

      device.getData = vi.fn().mockReturnValue({ controllerID: 0, thermostatID: 0 });
      (device as any).listeners = {};
      device.registerCapabilityListener = vi.fn().mockImplementation((cap, cb) => {
        if (cap === 'target_temperature' || cap === 'eco_mode') {
          (device as any).listeners[cap] = cb;
        }
      });

      await device.onInit();
    });

    it('should handle target temperature changes with debounce', async function() {
      const setTargetTemperatureSpy = vi.spyOn((device.driver as any).getClient(), 'setTargetTemperature').mockResolvedValue(undefined);
      device.setCapabilityValue = vi.fn().mockResolvedValue(undefined);

      const promise1 = (device as any)._setTargetTemperature(22.0, {});
      const promise2 = (device as any)._setTargetTemperature(22.5, {});
      const promise3 = (device as any)._setTargetTemperature(23.0, {});

      // Fast forward timers for debounce
      const timeoutMock = device.homey.setTimeout as import('vitest').Mock;
      const callback = timeoutMock.mock.calls[timeoutMock.mock.calls.length - 1][0];
      await callback();

      // All promises should resolve but only one API call is made with the latest value
      await Promise.all([promise1, promise2, promise3]);

      expect(setTargetTemperatureSpy).toHaveBeenCalledTimes(1);
      expect(setTargetTemperatureSpy).toHaveBeenCalledWith(0, 0, 23.0);
    });

    it('should handle thermostat mode changes', async function() {
      const setGlobalHeatCoolModeSpy = vi.spyOn((device.driver as any).getClient(), 'setGlobalHeatCoolMode').mockResolvedValue(undefined);
      const setGlobalEcoModeSpy = vi.spyOn((device.driver as any).getClient(), 'setGlobalEcoMode').mockResolvedValue(undefined);
      const setThermostatEcoModeSpy = vi.spyOn((device.driver as any).getClient(), 'setThermostatEcoMode').mockResolvedValue(undefined);

      device.setCapabilityValue = vi.fn().mockResolvedValue(undefined);

      // Test heat
      await (device as any)._setThermostatMode('heat', {});
      expect(setGlobalHeatCoolModeSpy).toHaveBeenCalledWith('heat');
      expect(setGlobalEcoModeSpy).toHaveBeenCalledWith(false);
      expect(setThermostatEcoModeSpy).toHaveBeenCalledWith(0, 0, false);

      // Test cool
      await (device as any)._setThermostatMode('cool', {});
      expect(setGlobalHeatCoolModeSpy).toHaveBeenCalledWith('cool');
      expect(setGlobalEcoModeSpy).toHaveBeenCalledWith(false);
      expect(setThermostatEcoModeSpy).toHaveBeenCalledWith(0, 0, false);

      // Test eco
      await (device as any)._setThermostatMode('eco', {});
      expect(setGlobalEcoModeSpy).toHaveBeenCalledWith(false);
      expect(setThermostatEcoModeSpy).toHaveBeenCalledWith(0, 0, true);

      // Test holiday
      await (device as any)._setThermostatMode('holiday', {});
      expect(setGlobalEcoModeSpy).toHaveBeenCalledWith(true);
    });
  });

  describe('error handling', function() {
    beforeEach(async function() {
      device.hasCapability = vi.fn().mockReturnValue(true);
      device.addCapability = vi.fn();
      device.registerCapabilityListener = vi.fn();
      device.setUnavailable = vi.fn();
      await device.onInit();
    });

    it('should mark device unavailable on error', async function() {
      // Force the mock client to throw an error when fetching thermostat data
      (device.driver as any).getClient().getThermostat = vi.fn().mockImplementation(() => {
        throw new Error('Network offline');
      });

      // Run sync
      await device.updateData();

      // Check error handling
      expect(device.homey.error).toHaveBeenCalledWith(expect.any(Error));
      expect(device.setUnavailable).toHaveBeenCalledWith('Could not fetch data from Uponor controller');
    });

    it('should mark device unavailable if thermostat data is missing', async function() {
      // Force the mock client to return undefined for this specific thermostat
      (device.driver as any).getClient().getThermostat = vi.fn().mockReturnValue(undefined);

      // Run sync
      await device.updateData();

      // Check error handling
      expect(device.setUnavailable).toHaveBeenCalledWith('Could not find thermostat data');
    });
  });

  describe('cooling capability options', function() {
    beforeEach(async function() {
      device.hasCapability = vi.fn().mockReturnValue(true);
      device.addCapability = vi.fn();
      device.registerCapabilityListener = vi.fn();
      await device.onInit();
    });

    it('should remove cool option when system cooling is unavailable', async function() {
      (device.driver as any).getClient().getSystemMetrics = vi.fn().mockReturnValue({ generalSystemAlarm: false, coolingAvailable: false });
      device.getCapabilityOptions = vi.fn().mockReturnValue({
        values: [
          { id: 'heat', title: { en: 'Heating', nl: 'Verwarmen' } },
          { id: 'cool', title: { en: 'Cooling', nl: 'Koelen' } },
          { id: 'eco', title: { en: 'Eco', nl: 'Eco' } },
          { id: 'holiday', title: { en: 'Holiday', nl: 'Vakantie' } },
        ],
      });

      await device.updateData();

      expect(device.setCapabilityOptions).toHaveBeenCalledWith('thermostat_mode', {
        values: [
          { id: 'heat', title: { en: 'Heating', nl: 'Verwarmen' } },
          { id: 'eco', title: { en: 'Eco', nl: 'Eco' } },
          { id: 'holiday', title: { en: 'Holiday', nl: 'Vakantie' } },
        ],
      });
    });

    it('should remove cool option when thermostat coolingAllowed is false', async function() {
      (device.driver as any).getClient().getSystemMetrics = vi.fn().mockReturnValue({ generalSystemAlarm: false, coolingAvailable: true });
      (device.driver as any).getClient().getThermostat = vi.fn().mockReturnValue({
        id: 'C0_T0',
        controllerID: 0,
        thermostatID: 0,
        temperature: 20,
        setPoint: 20,
        active: false,
        bypassEnabled: false,
        ecoMode: false,
        coolingAllowed: false,
        alarms: {},
      });
      device.getCapabilityOptions = vi.fn().mockReturnValue({
        values: [
          { id: 'heat', title: { en: 'Heating', nl: 'Verwarmen' } },
          { id: 'cool', title: { en: 'Cooling', nl: 'Koelen' } },
          { id: 'eco', title: { en: 'Eco', nl: 'Eco' } },
          { id: 'holiday', title: { en: 'Holiday', nl: 'Vakantie' } },
        ],
      });

      await device.updateData();

      expect(device.setCapabilityOptions).toHaveBeenCalledWith('thermostat_mode', {
        values: [
          { id: 'heat', title: { en: 'Heating', nl: 'Verwarmen' } },
          { id: 'eco', title: { en: 'Eco', nl: 'Eco' } },
          { id: 'holiday', title: { en: 'Holiday', nl: 'Vakantie' } },
        ],
      });
    });

    it('should restore cool option when cooling becomes available and was previously missing', async function() {
      (device.driver as any).getClient().getSystemMetrics = vi.fn().mockReturnValue({ generalSystemAlarm: false, coolingAvailable: true });
      (device.driver as any).getClient().getThermostat = vi.fn().mockReturnValue({
        id: 'C0_T0',
        controllerID: 0,
        thermostatID: 0,
        temperature: 20,
        setPoint: 20,
        active: false,
        bypassEnabled: false,
        ecoMode: false,
        coolingAllowed: true,
        alarms: {},
      });
      // Cool option currently missing in persistent capability options
      device.getCapabilityOptions = vi.fn().mockReturnValue({
        values: [
          { id: 'heat', title: { en: 'Heating', nl: 'Verwarmen' } },
          { id: 'eco', title: { en: 'Eco', nl: 'Eco' } },
          { id: 'holiday', title: { en: 'Holiday', nl: 'Vakantie' } },
        ],
      });

      await device.updateData();

      expect(device.setCapabilityOptions).toHaveBeenCalledWith('thermostat_mode', {
        values: [
          { id: 'heat', title: { en: 'Heating', nl: 'Verwarmen' } },
          { id: 'cool', title: { en: 'Cooling', nl: 'Koelen' } },
          { id: 'eco', title: { en: 'Eco', nl: 'Eco' } },
          { id: 'holiday', title: { en: 'Holiday', nl: 'Vakantie' } },
        ],
      });
    });
  });

  describe('discovery', function() {
    it('should update IP address on discovery address change', async function() {
      device.setStoreValue = vi.fn();
      const getClientSpy = vi.spyOn(device.driver as any, 'getClient');

      await device.onDiscoveryAddressChanged({ id: 'C0_T0', address: '192.168.1.101', mac: '00:11:22' } as any);

      expect(device.setStoreValue).toHaveBeenCalledWith('address', '192.168.1.101');
      expect(getClientSpy).toHaveBeenCalledWith('192.168.1.101');
    });
  });
});
