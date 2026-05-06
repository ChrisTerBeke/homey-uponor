import { describe, it, expect, vi, beforeEach } from 'vitest';
import UponorThermostatDevice from '../drivers/uponor/device.mjs';
import { UponorHTTPClient } from '../lib/UponorHTTPClient.mjs';

// Mock the HTTP client so we don't make real network requests in device tests
vi.mock('../lib/UponorHTTPClient.mjs', () => {
    const UponorHTTPClientMock = vi.fn().mockImplementation(function() {
        return {
            syncAttributes: vi.fn(),
            getThermostat: vi.fn().mockReturnValue({
                id: "C0_T0",
                controllerID: 0,
                thermostatID: 0,
                name: "Living Room",
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
                        heatFallback: false
                    }
                }),
            getGlobalHeatCoolMode: vi.fn().mockReturnValue('heat'),
            getGlobalEcoMode: vi.fn().mockReturnValue(false),
            getAttribute: vi.fn().mockReturnValue('0')
        };
    });
    return {
        UponorHTTPClient: UponorHTTPClientMock,
    };
});

describe('UponorThermostatDevice', () => {
    let device: UponorThermostatDevice;

    beforeEach(() => {
        device = new UponorThermostatDevice();
        device.getStoreValue = vi.fn().mockImplementation((key) => {
            if (key === 'controllerID') return 0;
            if (key === 'thermostatID') return 0;
            if (key === 'address') return '192.168.1.100';
            return null;
        });
        
        device.getData = vi.fn().mockReturnValue({ id: "C0_T0" });
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
            getClient: vi.fn().mockReturnValue(new UponorHTTPClient('1.2.3.4'))
        } as any;
    });

    it('should initialize and sync capabilities', async () => {
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
});
