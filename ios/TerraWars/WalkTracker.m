#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

/**
 * Objective-C interface for the Swift `WalkTracker`.
 *
 * A Swift `RCTEventEmitter` still needs this macro block so React Native's
 * module registry can find it and typecheck the exported signatures. Keep the
 * selectors here in exact step with the `@objc(...)` names in WalkTracker.swift
 * — a mismatch fails silently at runtime with "method not found", not at build
 * time.
 */
@interface RCT_EXTERN_MODULE (WalkTracker, RCTEventEmitter)

RCT_EXTERN_METHOD(start
                  : (NSDictionary *)options resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pause
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(resume
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getStatus
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getCurrentPosition
                  : (nonnull NSNumber *)timeoutMs resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateNotification
                  : (NSString *)title body
                  : (NSString *)body resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

@end
