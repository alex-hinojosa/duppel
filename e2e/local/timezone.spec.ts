import { test, expect } from '../fixtures/extension';
import { collectTimezone } from '../helpers/fingerprint-collector';
import { KNOWN_TIMEZONES } from '../helpers/profile-constants';

test.describe('Timezone spoofing', () => {
  test('timezone is from known set', async ({ extensionPage }) => {
    const tz = await collectTimezone(extensionPage);
    expect(KNOWN_TIMEZONES).toContain(tz.timezone);
  });

  test('offset is consistent with timezone', async ({ extensionPage }) => {
    const tz = await collectTimezone(extensionPage);

    // Map timezone to expected offset ranges (minutes, positive = west of UTC)
    const offsetRanges: Record<string, number[]> = {
      'America/New_York':      [240, 300],  // EDT=-4, EST=-5
      'America/Chicago':       [300, 360],  // CDT=-5, CST=-6
      'America/Denver':        [360, 420],  // MDT=-6, MST=-7
      'America/Los_Angeles':   [420, 480],  // PDT=-7, PST=-8
      'America/Phoenix':       [420, 420],  // MST=-7 (no DST)
      'Europe/London':         [0, -60],    // GMT=0, BST=+1
      'Europe/Berlin':         [-60, -120], // CET=+1, CEST=+2
      'America/Toronto':       [240, 300],  // EDT=-4, EST=-5
    };

    const range = offsetRanges[tz.timezone];
    if (range) {
      const min = Math.min(...range);
      const max = Math.max(...range);
      expect(tz.offset).toBeGreaterThanOrEqual(min);
      expect(tz.offset).toBeLessThanOrEqual(max);
    }
  });
});
