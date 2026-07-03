import type { ExtractionResult } from './extract';

export function isCloudflareChallenge(body: string): boolean {
  const patterns = [
    /checking your browser/i,
    /DDoS protection by Cloudflare/i,
    /__cf_chl_/i,
    /Please wait while we verify/i,
    /Please wait while we perform/i,
    /Please wait while we load.*browser/i,
    /Ray ID:|cf-ray/i,
  ];
  return patterns.some(p => p.test(body));
}

export function isProtectedOrJsHeavy(html: string): boolean {
  const body = html.toLowerCase();

  // 1. Bot protection markers
  const botSignals = [
    /cloudflare.*challeng/i,
    /__cf_chl__/,
    /js_challenge/,
    /captcha|verify_you_are_human/i,
    /perimeterx|dx\.co/i,
    /datadome\.co|datadome\.com/i,
    /hcaptcha\.com|recaptcha\.net|google\.com\/recaptcha/i,
    /imperva|incapsula/i,
    /bancal\.ai|arkoselabs/i,
    /verify.*first/i,
    /session.*expired.*verify/i,
    /protected.*by.*bot/i,
    /enable.*javascript.*browser/i,
    /your browser must enable javascript/i,
    /please enable javascript/i,
    /security check/i,
  ];
  if (botSignals.some(p => p.test(body))) return true;

  // 2. SPA/JS-rendered patterns — page is mostly empty without JS
  const bodyContent = body.replace(/<body[^>]*>([\s\S]*?)<\/body>/i, '$1');
  const textOnly = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const scriptCount = (body.match(/<script[^>]*>/gi) || []).length;
  const hasFewTextButManyScripts = textOnly.length < 50 && scriptCount > 5;
  if (hasFewTextButManyScripts) return true;

  // 3. SPA frameworks / JS-rendered indicators
  const spaIndicators = [
    /<\/noscript>\s*<div\s+id="__nuxt"/i,
    /<\/noscript>\s*<div\s+id="__vue__"/i,
    /<\/noscript>\s*<div\s+id="app"/i,
    /window\.__NUXT__\s*=\s*\{/i,
    /window\.__PRELOADED_STATE__|window\.__NEXT_DATA__|window\.__REDUX_STATE__/i,
  ];
  if (spaIndicators.some(p => p.test(body))) return true;

  // 4. "This site requires JavaScript" messages
  const jsRequiredPatterns = [
    /this site requires javascript/i,
    /please enable javascript/i,
    /your browser does not support javascript/i,
  ];
  if (jsRequiredPatterns.some(p => p.test(body))) return true;

  return false;
}

export function isDefuddleFailure(result: ExtractionResult): boolean {
  const contentEmpty = !result.bodyText || result.bodyText.trim().length < 150;
  const titleBad = !result.title ||
    result.title === 'Untitled' ||
    result.title === 'Untitled Document' ||
    /^https?:\/\/[^/]+/i.test(result.title || '');
  return contentEmpty || titleBad;
}