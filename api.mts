import { UponorDriver } from './drivers/uponor/driver.mjs';

export default {
  async get_debug({ homey }: { homey: any }) {
    const driver = homey.drivers.getDriver('uponor') as UponorDriver;
    if (!driver) {
      return { error: 'Uponor driver not found' };
    }
    return driver.getDebugData();
  },
};
