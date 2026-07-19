import { IPNetwork } from '../ip-network';

// Pre-compute blocked networks once at module load
const BLOCKED_NETWORKS: IPNetwork[] = [
  // Loopback
  new IPNetwork('127.0.0.0', 8),
  // Any
  new IPNetwork('0.0.0.0', 8),
  // Link-local
  new IPNetwork('169.254.0.0', 16),
  // CGNAT
  new IPNetwork('100.64.0.0', 10),
  // Multicast
  new IPNetwork('224.0.0.0', 4),
  // Reserved / future use
  new IPNetwork('240.0.0.0', 4),
  // Private ranges
  new IPNetwork('10.0.0.0', 8),
  new IPNetwork('172.16.0.0', 12),
  new IPNetwork('192.168.0.0', 16),
  // Link-local (alternate notation)
  new IPNetwork('169.254.169.254', 32),
];

// Blocked hostnames (case-insensitive)
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata.aws.internal',
]);

// Blocked schemes
const BLOCKED_SCHEMES = new Set(['file', 'data', 'ftp', 'gopher', 'telnet']);

/**
 * Check if a URL is safe to fetch (not SSRF).
 * Returns true if the URL is safe, false if it should be blocked.
 */
export function isSafeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // Invalid URL
  }

  // Check scheme
  if (BLOCKED_SCHEMES.has(parsed.protocol.replace(':', '').toLowerCase())) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return false;
  }

  // Check if hostname is localhost (with optional port)
  if (hostname === 'localhost' || hostname.startsWith('localhost.')) {
    return false;
  }

  // Check if hostname is an IP address
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const ipNum = ipToNumber(hostname);
    if (ipNum !== null) {
      for (const network of BLOCKED_NETWORKS) {
        if (network.contains(ipNum)) {
          return false;
        }
      }
    }
  }

  // For non-IP hostnames, try to resolve and check
  // Note: In a real implementation, you'd use dns.lookup() here
  // For now, we only block known-bad patterns

  return true;
}

/**
 * Convert an IPv4 address string to a 32-bit number.
 */
function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) + n;
  }

  return num >>> 0; // Unsigned 32-bit
}