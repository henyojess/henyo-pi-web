import { describe, it, expect } from 'vitest';
import { isSafeUrl } from '../shared/fetch/security';

describe('isSafeUrl', () => {
  describe('should allow', () => {
    it('allows https://example.com', () => {
      expect(isSafeUrl('https://example.com')).toBe(true);
    });

    it('allows https://github.com', () => {
      expect(isSafeUrl('https://github.com')).toBe(true);
    });

    it('allows https://1.1.1.1', () => {
      expect(isSafeUrl('https://1.1.1.1')).toBe(true);
    });

    it('allows https://www.google.com', () => {
      expect(isSafeUrl('https://www.google.com')).toBe(true);
    });

    it('allows https://8.8.8.8', () => {
      expect(isSafeUrl('https://8.8.8.8')).toBe(true);
    });

    it('allows https://example.com/path?query=1', () => {
      expect(isSafeUrl('https://example.com/path?query=1')).toBe(true);
    });
  });

  describe('should block localhost', () => {
    it('blocks http://localhost', () => {
      expect(isSafeUrl('http://localhost')).toBe(false);
    });

    it('blocks http://localhost:3000', () => {
      expect(isSafeUrl('http://localhost:3000')).toBe(false);
    });

    it('blocks http://127.0.0.1', () => {
      expect(isSafeUrl('http://127.0.0.1')).toBe(false);
    });

    it('blocks http://127.0.0.255', () => {
      expect(isSafeUrl('http://127.0.0.255')).toBe(false);
    });

    it('blocks http://127.255.255.255', () => {
      expect(isSafeUrl('http://127.255.255.255')).toBe(false);
    });
  });

  describe('should block private IPs', () => {
    it('blocks http://192.168.1.1', () => {
      expect(isSafeUrl('http://192.168.1.1')).toBe(false);
    });

    it('blocks http://192.168.0.1', () => {
      expect(isSafeUrl('http://192.168.0.1')).toBe(false);
    });

    it('blocks http://10.0.0.1', () => {
      expect(isSafeUrl('http://10.0.0.1')).toBe(false);
    });

    it('blocks http://10.255.255.255', () => {
      expect(isSafeUrl('http://10.255.255.255')).toBe(false);
    });

    it('blocks http://172.16.0.1', () => {
      expect(isSafeUrl('http://172.16.0.1')).toBe(false);
    });

    it('blocks http://172.31.255.255', () => {
      expect(isSafeUrl('http://172.31.255.255')).toBe(false);
    });

    it('blocks http://172.16.0.0', () => {
      expect(isSafeUrl('http://172.16.0.0')).toBe(false);
    });
  });

  describe('should block link-local and metadata', () => {
    it('blocks http://169.254.0.1', () => {
      expect(isSafeUrl('http://169.254.0.1')).toBe(false);
    });

    it('blocks http://169.254.169.254/latest/meta-data/', () => {
      expect(isSafeUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    });

    it('blocks http://169.254.255.255', () => {
      expect(isSafeUrl('http://169.254.255.255')).toBe(false);
    });
  });

  describe('should block dangerous schemes', () => {
    it('blocks file:///etc/passwd', () => {
      expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    });

    it('blocks data:text/html,<h1>test</h1>', () => {
      expect(isSafeUrl('data:text/html,<h1>test</h1>')).toBe(false);
    });

    it('blocks ftp://example.com', () => {
      expect(isSafeUrl('ftp://example.com')).toBe(false);
    });
  });

  describe('should block invalid URLs', () => {
    it('blocks empty string', () => {
      expect(isSafeUrl('')).toBe(false);
    });

    it('blocks malformed URL', () => {
      expect(isSafeUrl('not a url')).toBe(false);
    });

    it('blocks just a domain without scheme', () => {
      expect(isSafeUrl('example.com')).toBe(false);
    });
  });
});