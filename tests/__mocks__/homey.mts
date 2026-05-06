import { vi } from 'vitest';

export class App {
    log = vi.fn();
    error = vi.fn();
}

export class Driver {
    log = vi.fn();
    error = vi.fn();
    homey = {
        app: new App(),
        log: vi.fn(),
        error: vi.fn(),
    };
    onInit = vi.fn();
}

export class Device {
    log = vi.fn();
    error = vi.fn();
    homey = {
        app: new App(),
        log: vi.fn(),
        error: vi.fn(),
    };
    setCapabilityValue = vi.fn();
    getCapabilityValue = vi.fn();
    setAvailable = vi.fn();
    setUnavailable = vi.fn();
    addCapability = vi.fn();
    hasCapability = vi.fn().mockReturnValue(true);
    registerCapabilityListener = vi.fn();
    getSettings = vi.fn().mockReturnValue({});
    setSettings = vi.fn();
    getStoreValue = vi.fn();
    setStoreValue = vi.fn();
    onInit = vi.fn();
}

export default {
    App,
    Driver,
    Device,
};
