/**
 * Represents an IPv4 CIDR network (e.g., 10.0.0.0/8).
 * Used for SSRF protection to block private/reserved IP ranges.
 */
export class IPNetwork {
  public readonly network: number;
  public readonly mask: number;

  constructor(public readonly address: string, public readonly prefixLength: number) {
    this.network = ipToNumber(address)!;
    // Create mask: all 1s in the prefix, 0s elsewhere
    this.mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  }

  /**
   * Check if an IP number falls within this network.
   */
  contains(ipNum: number): boolean {
    return (ipNum & this.mask) === (this.network & this.mask);
  }
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) + n;
  }

  return num >>> 0;
}