import { describe, it, expect } from 'vitest';
import { isValidIpv4Address, normalizeIpv4Address } from '../lib/ipAddress.mjs';

describe('normalizeIpv4Address', () => {
  it.each([
    ['192.168.1.100', '192.168.1.100'],
    [' 10.0.0.1 ', '10.0.0.1'],
    ['0.0.0.0', '0.0.0.0'],
    ['255.255.255.255', '255.255.255.255'],
  ])('accepts %j', (input, expected) => {
    expect(normalizeIpv4Address(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['evil.com'],
    ['192.168.1.100/JNAP'],
    ['192.168.1.100:8080'],
    ['192.168.1.100@evil.com'],
    ['http://192.168.1.100'],
    ['192.168.1.256'],
    ['192.168.1'],
    ['192.168.01.1'],
    ['127.0.0.1/../../'],
    ['::1'],
    ['localhost'],
  ])('rejects %j', (input) => {
    expect(() => normalizeIpv4Address(input)).toThrow();
    expect(isValidIpv4Address(input)).toBe(false);
  });
});

describe('UponorHTTPClient IP validation', () => {
  it('rejects malicious hosts in the constructor', async () => {
    const { UponorHTTPClient } = await import('../lib/UponorHTTPClient.mjs');
    expect(() => new UponorHTTPClient('evil.com')).toThrow(/Invalid IPv4/);
    expect(() => new UponorHTTPClient('192.168.1.1@attacker')).toThrow(/Invalid IPv4/);
    expect(() => new UponorHTTPClient('169.254.169.254:80')).toThrow(/Invalid IPv4/);
  });
});
