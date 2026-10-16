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

describe('effective setpoint (active eco/cooling setback)', () => {
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

  it.each([
    ['heating, no eco', {}, 22, 0],
    ['heating, room eco', { C1_T1_stat_cb_comfort_eco_mode: '1' }, 18, 72],
    ['heating, holiday (global eco)', { sys_forced_eco_mode: '1' }, 18, 72],
    ['cooling (issue #34)', { sys_heat_cool_mode: '1' }, 24, -36],
    ['cooling + eco', { sys_heat_cool_mode: '1', C1_T1_stat_cb_comfort_eco_mode: '1' }, 28, -108],
    ['eco active but eco_offset 0', { C1_T1_stat_cb_comfort_eco_mode: '1', C1_T1_eco_offset: '0' }, 22, 0],
    ['setpoint at min limit', { C1_T1_setpoint: '410', C1_T1_stat_cb_comfort_eco_mode: '1' }, 5, 0],
    ['setpoint at max limit', { C1_T1_setpoint: '950', sys_heat_cool_mode: '1' }, 35, 0],
  ])('%s', async (_name, over, effective, setbackRaw) => {
    const t = await load(over as Record<string, string>);
    expect(t.effectiveSetPoint).toBe(effective);
    expect(client.getActiveSetbackRaw(1, 1, Number(client.getAttribute('C1_T1_setpoint')))).toBe(setbackRaw);
  });

  it('ignores cust_Temporary_ECO_Activation', async () => {
    const t = await load({ cust_Temporary_ECO_Activation: '1' });
    expect(t.effectiveSetPoint).toBe(22);
  });

  it('does not change setPoint (target_temperature) in any mode', async () => {
    const t = await load({ sys_heat_cool_mode: '1', C1_T1_stat_cb_comfort_eco_mode: '1' });
    expect(t.setPoint).toBe(22);
  });

  it('setTargetTemperature writes the value without compensation (legacy)', async () => {
    await load({ sys_heat_cool_mode: '1', C1_T1_stat_cb_comfort_eco_mode: '1' });
    fetchMock.mockResolvedValue(ok());
    await client.setTargetTemperature(1, 1, 18);
    expect(sentValue(1)).toBe('644');
    expect(client.getThermostat(1, 1)!.setPoint).toBe(18);
  });
});
