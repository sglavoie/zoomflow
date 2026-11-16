// Test-browser workaround for macOS 27's STScreenTimeConfigurationObserver
// teardown crash. This uses the same private feature API as WebKit's embedder.
// Remove when the bundled WebKit/macOS combination no longer needs it.
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

@interface WKPreferences (ZoomflowScreenTime)
+ (NSArray *)_features;
- (BOOL)_isEnabledForFeature:(id)feature;
- (void)_setEnabled:(BOOL)value forFeature:(id)feature;
@end

@interface NSObject (ZoomflowFeatureKey)
- (NSString *)key;
@end

static id screenTimeFeature;
static IMP originalInitializer;

static void fail(const char *message) {
    fprintf(stderr, "[zoomflow-webkit] %s\n", message);
    exit(78);
}

static id initializeWithoutScreenTime(id view, SEL selector, NSRect frame,
                                     WKWebViewConfiguration *configuration) {
    WKPreferences *preferences = configuration.preferences;
    [preferences _setEnabled:NO forFeature:screenTimeFeature];
    if ([preferences _isEnabledForFeature:screenTimeFeature])
        fail("Could not disable ScreenTimeEnabled; refusing an unprotected launch.");

    if (getenv("ZOOMFLOW_WEBKIT_DIAGNOSTICS"))
        fprintf(stderr, "[zoomflow-webkit] ScreenTimeEnabled=0 before WKWebView initialization\n");
    return ((id (*)(id, SEL, NSRect, WKWebViewConfiguration *))originalInitializer)(
        view, selector, frame, configuration);
}

__attribute__((constructor)) static void installScreenTimeWorkaround(void) {
    @autoreleasepool {
        // DYLD variables can propagate to WebKit child processes. Only the
        // Playwright UI process owns WKWebViews and needs this workaround.
        if (![[NSProcessInfo processInfo].processName isEqualToString:@"Playwright"])
            return;
        if (![WKPreferences respondsToSelector:@selector(_features)] ||
            ![WKPreferences instancesRespondToSelector:@selector(_setEnabled:forFeature:)] ||
            ![WKPreferences instancesRespondToSelector:@selector(_isEnabledForFeature:)])
            fail("Bundled WebKit's feature API changed; update the Screen Time workaround.");

        for (id feature in [WKPreferences _features]) {
            if ([[feature key] isEqualToString:@"ScreenTimeEnabled"]) {
                screenTimeFeature = [feature retain];
                break;
            }
        }
        if (!screenTimeFeature)
            fail("ScreenTimeEnabled is unavailable; re-evaluate the workaround.");
        Method initializer = class_getInstanceMethod(
            [WKWebView class], @selector(initWithFrame:configuration:));
        if (!initializer)
            fail("WKWebView's initializer changed; update the Screen Time workaround.");
        originalInitializer = method_setImplementation(initializer, (IMP)initializeWithoutScreenTime);
    }
}
