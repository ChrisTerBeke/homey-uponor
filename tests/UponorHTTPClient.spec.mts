import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UponorHTTPClient, Thermostat } from '../lib/UponorHTTPClient.mjs';

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
                "result": "OK",
                "output": {
                  "vars": [
                    { "waspVarName": "85", "waspVarValue": "1" },
                    { "waspVarName": "sys_controller_0_th_0_temp_room_value", "waspVarValue": "21.5" },
                    { "waspVarName": "cust_C0_T0_name", "waspVarValue": "Living Room" }
                  ]
                }
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
                json: async () => ({})
            });

            const promise = client.syncAttributes();
            await expect(promise).rejects.toThrow('Could not sync raw attributes');
        });
    });
});
