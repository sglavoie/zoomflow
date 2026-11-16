#!/bin/sh
# Playwright rejects a bare preference value in launchOptions.args as a page URL.
# Forward its default arguments to the same bundled browser, then append the
# process-local Cocoa preference. No defaults database or browser cache is edited.
exec "${ZOOMFLOW_WEBKIT_EXECUTABLE:?Set by playwright.config.ts}" "$@" -WebKitDebugScreenTimeEnabled false
