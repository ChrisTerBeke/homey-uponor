import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { UponorHTTPClient } from '../lib/UponorHTTPClient.mjs';

// Define a mock fetch that we can control
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

describe('UponorHTTPClient', () => {
  let client: UponorHTTPClient;

  beforeEach(() => {
    client = new UponorHTTPClient('192.168.1.100');
    fetchMock.mockReset();
  });

  it('should initialize successfully', () => {
    expect(client).toBeDefined();
  });

  describe('syncAttributes', () => {
    it('should successfully fetch and parse thermostats data', async () => {
      const mockResponseData = {
        result: 'OK',
        output: {
          vars: [
            { waspVarName: '85', waspVarValue: '1' },
            { waspVarName: 'sys_controller_0_th_0_temp_room_value', waspVarValue: '21.5' },
            { waspVarName: 'cust_C0_T0_name', waspVarValue: 'Living Room' },
          ],
        },
      };

      // Set up our mock fetch response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
      });

      await client.syncAttributes();
      const thermostats = client.getThermostats();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.100/JNAP/', expect.any(Object));
      expect(thermostats.size).toBe(1);
    });

    it('should throw an error on non-ok HTTP response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });

      const promise = client.syncAttributes();
      await expect(promise).rejects.toThrow('Could not sync raw attributes');
    });
  });

  describe('setters and cache invalidation', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: 'OK' }),
      });
    });

    it('should correctly format and send setTargetTemperature', async () => {
      await client.setTargetTemperature(0, 1, 22.5); // 22.5 C = 72.5 F -> 725

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      expect(callArgs[0]).toBe('http://192.168.1.100/JNAP/');
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].headers['x-jnap-action']).toBe('http://phyn.com/jnap/uponorsky/SetAttributes');
      expect(JSON.parse(callArgs[1].body)).toEqual({
        vars: [{ waspVarName: 'C0_T1_setpoint', waspVarValue: '725' }],
      });
    });

    it('should correctly format and send setThermostatEcoMode', async () => {
      await client.setThermostatEcoMode(0, 2, true);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        vars: [{ waspVarName: 'C0_T2_mode_comfort_eco', waspVarValue: '1' }],
      });

      await client.setThermostatEcoMode(0, 2, false);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        vars: [{ waspVarName: 'C0_T2_mode_comfort_eco', waspVarValue: '0' }],
      });
    });

    it('should correctly format and send setGlobalEcoMode', async () => {
      await client.setGlobalEcoMode(true);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        vars: [{ waspVarName: 'sys_forced_eco_mode', waspVarValue: '1' }],
      });
    });

    it('should correctly format and send setGlobalHeatCoolMode', async () => {
      await client.setGlobalHeatCoolMode('cool');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        vars: [{ waspVarName: 'sys_heat_cool_mode', waspVarValue: '1' }],
      });
    });

    it('should update cache when setting a value to prevent fetch spikes', async () => {
      // First sync to set up the cache
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'OK', output: { vars: [] } }),
      });
      await client.syncAttributes();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second sync should use cache (no new fetch)
      await client.syncAttributes();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Set a value, which should update cache instead of invalidating it
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'OK' }),
      });
      await client.setGlobalEcoMode(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(client.getGlobalEcoMode()).toBe(true);

      // We need to mock a GetAttributes call because syncAttributes() runs _parseAttributes()
      // which OVERWRITES the _attributes map completely with whatever was in _rawAttributes!
      // Since _rawAttributes still contains the old data (from the first fetch), it will overwrite
      // the optimistic update! Wait, yes!
      // To fix this in code, we shouldn't overwrite _attributes if _lastSync is valid,
      // OR we just don't run _parseAttributes if _syncRawAttributes returns early.

      // Let's first make the test pass so we can see the code fix

      await client.syncAttributes();
      expect(fetchMock).toHaveBeenCalledTimes(2); // Still 2

      expect(client.getGlobalEcoMode()).toBe(true);
    });
  });

  describe('parsers', () => {
    it('should correctly parse global eco mode', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'OK', output: { vars: [{ waspVarName: 'sys_forced_eco_mode', waspVarValue: '1' }] } }),
      });
      await client.syncAttributes();
      expect(client.getGlobalEcoMode()).toBe(true);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'OK', output: { vars: [{ waspVarName: 'sys_forced_eco_mode', waspVarValue: '0' }] } }),
      });
      client['_lastSync'] = undefined; // Force sync
      await client.syncAttributes();
      expect(client.getGlobalEcoMode()).toBe(false);
    });

    it('should correctly parse global heat/cool mode', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'OK', output: { vars: [{ waspVarName: 'sys_heat_cool_mode', waspVarValue: '1' }] } }),
      });
      await client.syncAttributes();
      expect(client.getGlobalHeatCoolMode()).toBe('cool');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'OK', output: { vars: [{ waspVarName: 'sys_heat_cool_mode', waspVarValue: '0' }] } }),
      });
      client['_lastSync'] = undefined; // Force sync
      await client.syncAttributes();
      expect(client.getGlobalHeatCoolMode()).toBe('heat');
    });

    it('should correctly parse thermostat coolingAllowed with fallback to true when missing', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          result: 'OK',
          output: {
            vars: [
              { waspVarName: 'cust_C1_T1_name', waspVarValue: 'Room 1' },
              { waspVarName: 'C1_T1_cooling_allowed', waspVarValue: '1' },
              { waspVarName: 'cust_C1_T2_name', waspVarValue: 'Room 2' },
              { waspVarName: 'C1_T2_cooling_allowed', waspVarValue: '0' },
              { waspVarName: 'cust_C1_T3_name', waspVarValue: 'Room 3' },
              { waspVarName: 'C1_T3_cool_allowed', waspVarValue: '1' },
              { waspVarName: 'cust_C1_T4_name', waspVarValue: 'Room 4' },
            ],
          },
        }),
      });
      await client.syncAttributes();
      const t1 = client.getThermostat(1, 1);
      const t2 = client.getThermostat(1, 2);
      const t3 = client.getThermostat(1, 3);
      const t4 = client.getThermostat(1, 4);

      expect(t1?.coolingAllowed).toBe(true);
      expect(t2?.coolingAllowed).toBe(false);
      expect(t3?.coolingAllowed).toBe(true);
      expect(t4?.coolingAllowed).toBe(true);
    });

    it('should correctly parse floor temperatures, setpoint limits, and floor limit alarm', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          result: 'OK',
          output: {
            vars: [
              { waspVarName: 'cust_C1_T1_name', waspVarValue: 'Living Room' },
              { waspVarName: 'C1_T1_external_temperature', waspVarValue: '725' }, // 72.5 F -> 22.5 C
              { waspVarName: 'C1_T1_minimum_floor_setpoint', waspVarValue: '680' }, // 68.0 F -> 20.0 C
              { waspVarName: 'C1_T1_maximum_floor_setpoint', waspVarValue: '788' }, // 78.8 F -> 26.0 C
              { waspVarName: 'C1_T1_stat_cb_floor_limit_reach', waspVarValue: '1' },
            ],
          },
        }),
      });
      await client.syncAttributes();
      const t1 = client.getThermostat(1, 1);

      expect(t1?.floorTemperature).toBe(22.5);
      expect(t1?.minimumFloorSetPoint).toBe(20.0);
      expect(t1?.maximumFloorSetPoint).toBe(26.0);
      expect(t1?.alarms.floorLimit).toBe(true);
    });
  });
});
