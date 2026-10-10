import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { UponorHTTPClient } from '../lib/UponorHTTPClient.mjs';

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

function respond(vars: Record<string, string>) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ result: 'OK', output: { vars: Object.entries(vars).map(([waspVarName, waspVarValue]) => ({ waspVarName, waspVarValue })) } }),
  });
}

// values from the real dump in community.homey.app/t/109100/7-9
const base = {
  cust_C1_T1_name: 'Room',
  C1_T1_setpoint: '716', // 22.0°C
  C1_T1_minimum_setpoint: '410',
  C1_T1_maximum_setpoint: '950',
  C1_T1_eco_offset: '72', // 4.0°C delta
  sys_heat_cool_offset: '36', // 2.0°C delta
  sys_heat_cool_mode: '0',
  sys_forced_eco_mode: '0',
  C1_T1_stat_cb_comfort_eco_mode: '0',
  cust_Temporary_ECO_Activation: '1', // present as 1 in real dump without eco active; must be ignored
};

const ok = () => ({ ok: true, status: 200, json: async () => ({ result: 'OK' }) });
const sentValue = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body).vars[0].waspVarValue;

describe('setting off (default): legacy behaviour', () => {
  let client: UponorHTTPClient;
  beforeEach(() => {
    client = new UponorHTTPClient('1.2.3.4');
    fetchMock.mockReset();
  });

  async function load(over: Record<string, string>) {
    respond({ ...base, ...over });
    await client.syncAttributes();
    return client.getThermostat(1, 1)!;
  }

  it('is disabled by default', () => {
    expect(client.isSetbackIncluded()).toBe(false);
  });

  it.each([
    ['heating eco', { C1_T1_stat_cb_comfort_eco_mode: '1' }],
    ['holiday', { sys_forced_eco_mode: '1' }],
    ['cooling + eco', { sys_heat_cool_mode: '1', C1_T1_stat_cb_comfort_eco_mode: '1' }],
  ])('reads stored setpoint unchanged (%s)', async (_name, over) => {
    const t = await load(over);
    expect(t.setPoint).toBe(22);
    expect(t.activeSetback).toBe(0);
  });

  it('writes without compensation or clamping', async () => {
    await load({ sys_heat_cool_mode: '1', C1_T1_stat_cb_comfort_eco_mode: '1' });
    fetchMock.mockResolvedValue(ok());
    await client.setTargetTemperature(1, 1, 18);
    expect(sentValue(1)).toBe('644');
    await client.setTargetTemperature(1, 1, 40); // above max, legacy does not clamp
    expect(sentValue(2)).toBe('1040');
    expect(client.getThermostat(1, 1)!.setPoint).toBe(40);
  });
});

describe('setting on: effective setpoint with setbacks', () => {
  let client: UponorHTTPClient;
  beforeEach(() => {
    client = new UponorHTTPClient('1.2.3.4');
    client.setIncludeSetback(true);
    fetchMock.mockReset();
  });

  it('toggling the setting re-derives thermostats from cached attributes', async () => {
    client.setIncludeSetback(false);
    respond({ ...base, C1_T1_stat_cb_comfort_eco_mode: '1' });
    await client.syncAttributes();
    expect(client.getThermostat(1, 1)!.setPoint).toBe(22);
    client.setIncludeSetback(true);
    await Promise.resolve();
    expect(client.getThermostat(1, 1)!.setPoint).toBe(18);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores cust_Temporary_ECO_Activation', async () => {
    respond({ ...base, cust_Temporary_ECO_Activation: '1' });
    await client.syncAttributes();
    expect(client.getThermostat(1, 1)!.setPoint).toBe(22);
  });

  async function load(over: Record<string, string>) {
    respond({ ...base, ...over });
    await client.syncAttributes();
    return client.getThermostat(1, 1)!;
  }

  it('heating, no eco: target equals stored setpoint', async () => {
    const t = await load({});
    expect(t.setPoint).toBe(22);
    expect(t.baseSetPoint).toBe(22);
    expect(t.activeSetback).toBe(0);
  });

  it('heating, eco active: target lowered by eco offset', async () => {
    const t = await load({ C1_T1_stat_cb_comfort_eco_mode: '1' });
    expect(t.setPoint).toBe(18);
    expect(t.baseSetPoint).toBe(22);
  });

  it('heating, holiday (forced eco): target lowered', async () => {
    const t = await load({ sys_forced_eco_mode: '1' });
    expect(t.setPoint).toBe(18);
  });

  it('cooling: target raised by cool offset (issue #34)', async () => {
    const t = await load({ sys_heat_cool_mode: '1' });
    expect(t.setPoint).toBe(24);
  });

  it('cooling + eco: both offsets raise target', async () => {
    const t = await load({ sys_heat_cool_mode: '1', C1_T1_stat_cb_comfort_eco_mode: '1' });
    expect(t.setPoint).toBe(28);
  });

  it('setpoint at min limit: no offset applied', async () => {
    const t = await load({ C1_T1_setpoint: '410', C1_T1_stat_cb_comfort_eco_mode: '1' });
    expect(t.setPoint).toBe(5);
  });

  it('write compensates eco offset in heating', async () => {
    await load({ C1_T1_stat_cb_comfort_eco_mode: '1' });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 'OK' }) });
    await client.setTargetTemperature(1, 1, 18);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.vars[0]).toEqual({ waspVarName: 'C1_T1_setpoint', waspVarValue: '716' });
    expect(client.getThermostat(1, 1)!.setPoint).toBe(18);
  });

  it('write compensates cool offset and clamps to max', async () => {
    await load({ sys_heat_cool_mode: '1' });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: 'OK' }) });
    await client.setTargetTemperature(1, 1, 24);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).vars[0].waspVarValue).toBe('716');
    await client.setTargetTemperature(1, 1, 40);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).vars[0].waspVarValue).toBe('950');
  });

  it('write of exact min limit is not compensated', async () => {
    await load({ C1_T1_stat_cb_comfort_eco_mode: '1' });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 'OK' }) });
    await client.setTargetTemperature(1, 1, 5);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).vars[0].waspVarValue).toBe('410');
  });
});
