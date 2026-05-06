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
      getAttribute: vi.fn().mockReturnValue('0'),
      setTargetTemperature: vi.fn(),
      setThermostatEcoMode: vi.fn(),
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
    device.setCapabilityOptions = vi.fn();
    device.setAvailable = vi.fn();
    device.setCapabilityValue = vi.fn();
    device.homey = {
      setInterval: vi.fn(),
      setTimeout: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as any;

    // Mock driver access
    device.driver = {
      getClient: vi.fn().mockReturnValue(new UponorHTTPClient('1.2.3.4')),
      removeClient: vi.fn(),
    } as any;
  });

  it('should initialize and sync capabilities', async function() {
    // Need to mock hasCapability properly for init
    device.hasCapability = vi.fn().mockReturnValue(true);
    device.addCapability = vi.fn();
    device.registerCapabilityListener = vi.fn();

    await device.onInit();

    // Note: the test calls the internal `_syncAttributes` here directly because `onInit` only registers it in timeouts
    await (device as any)._syncAttributes();

    expect(device.homey.error).not.toHaveBeenCalled();
    expect(device.setAvailable).toHaveBeenCalled();
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_temperature', 21.5);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_temperature', 21.0);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('is_heating', true);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('bypass_enabled', false);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('eco_mode', false);
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

    it('should handle target temperature changes', async function() {
      const setTargetTemperatureSpy = vi.spyOn((device.driver as any).getClient(), 'setTargetTemperature').mockResolvedValue(undefined);

      // Trigger the capability listener as if the user changed the temperature in the Homey App

      // Actually call the method since listener registration mock isn't bound properly
      await (device as any)._setTargetTemperature(22.5, {});

      expect(setTargetTemperatureSpy).toHaveBeenCalledWith(0, 0, 22.5);
    });

    it('should handle eco mode changes', async function() {
      const setEcoModeSpy = vi.spyOn((device.driver as any).getClient(), 'setThermostatEcoMode').mockResolvedValue(undefined);

      // Trigger the capability listener

      await (device as any)._setEcoMode(true, {});

      expect(setEcoModeSpy).toHaveBeenCalledWith(0, 0, true);
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

    it('should mark device unavailable on network error', async function() {
      // Force the mock client to throw an error
      (device.driver as any).getClient().syncAttributes = vi.fn().mockRejectedValue(new Error('Network offline'));

      // Run sync
      await (device as any)._syncAttributes();

      // Check error handling
      expect(device.homey.error).toHaveBeenCalledWith(expect.any(Error));
      expect(device.setUnavailable).toHaveBeenCalledWith('Could not fetch data from Uponor controller');
    });

    it('should mark device unavailable if thermostat data is missing', async function() {
      // Force the mock client to return undefined for this specific thermostat
      (device.driver as any).getClient().getThermostat = vi.fn().mockReturnValue(undefined);

      // Run sync
      await (device as any)._syncAttributes();

      // Check error handling
      expect(device.setUnavailable).toHaveBeenCalledWith('Could not find thermostat data');
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
