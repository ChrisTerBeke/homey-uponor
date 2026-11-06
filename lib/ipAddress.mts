/**
 * Validates and normalizes an IPv4 address for use in `http://${ip}/JNAP/` URLs.
 * Rejects hostnames, paths, credentials, ports, and other SSRF/URL-injection shapes.
 */
export function normalizeIpv4Address(address: string): string {
  const trimmed = (address ?? '').trim();
  if (!trimmed) {
    throw new Error('IP address is required');
  }

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid IPv4 address: ${trimmed}`);
  }

  const octets = match.slice(1).map((part) => {
    const value = Number(part);
    // Reject out-of-range octets and leading zeros (e.g. 01, 001)
    if (!Number.isInteger(value) || value < 0 || value > 255 || String(value) !== part) {
      throw new Error(`Invalid IPv4 address: ${trimmed}`);
    }
    return value;
  });

  return octets.join('.');
}

export function isValidIpv4Address(address: string): boolean {
  try {
    normalizeIpv4Address(address);
    return true;
  } catch {
    return false;
  }
}
