import { describe, it, expect } from 'vitest';
import { IPNetwork } from '../shared/ip-network';

// Mirror of the file's private ipToNumber (test needs IP numbers for contains())
const ipNum = (ip: string): number =>
  ip.split('.').reduce((n, part) => (n << 8) + parseInt(part, 10), 0) >>> 0;

describe('IPNetwork', () => {
  describe('constructor', () => {
    it('uses mask 0 for a /0 prefix and contains every IP', () => {
      const net = new IPNetwork('10.0.0.0', 0);
      expect(net.mask).toBe(0);
      expect(net.network).toBe(ipNum('10.0.0.0'));
      expect(net.contains(ipNum('8.8.8.8'))).toBe(true);
      expect(net.contains(ipNum('192.168.1.1'))).toBe(true);
      expect(net.contains(ipNum('255.255.255.255'))).toBe(true);
    });

    it('computes the correct mask for a /24 prefix', () => {
      const net = new IPNetwork('192.168.1.0', 24);
      expect(net.mask).toBe(0xffffff00);
    });

    it('returns null network for a malformed address (not 4 groups)', () => {
      const net = new IPNetwork('1.2.3', 8);
      expect(net.network).toBeNull();
    });

    it('returns null network for an out-of-range octet', () => {
      const net = new IPNetwork('999.1.1.1', 8);
      expect(net.network).toBeNull();
    });
  });

  describe('contains', () => {
    it('/8: inside and outside', () => {
      const net = new IPNetwork('10.0.0.0', 8);
      expect(net.contains(ipNum('10.1.2.3'))).toBe(true);
      expect(net.contains(ipNum('11.0.0.1'))).toBe(false);
      expect(net.contains(ipNum('9.255.255.255'))).toBe(false);
    });

    it('/16: inside and outside', () => {
      const net = new IPNetwork('192.168.0.0', 16);
      expect(net.contains(ipNum('192.168.1.5'))).toBe(true);
      expect(net.contains(ipNum('192.169.0.1'))).toBe(false);
    });

    it('/12: inside and outside', () => {
      const net = new IPNetwork('172.16.0.0', 12);
      expect(net.contains(ipNum('172.16.5.5'))).toBe(true);
      expect(net.contains(ipNum('172.32.0.1'))).toBe(false);
    });

    it('/32: exact match only', () => {
      const net = new IPNetwork('169.254.169.254', 32);
      expect(net.contains(ipNum('169.254.169.254'))).toBe(true);
      expect(net.contains(ipNum('169.254.169.253'))).toBe(false);
    });
  });
});
