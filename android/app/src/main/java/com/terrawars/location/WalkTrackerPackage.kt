package com.terrawars.location

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [WalkTrackerModule].
 *
 * Added manually in MainApplication rather than autolinked: autolinking is for
 * npm packages, and this module is app-local because the foreground-service
 * lifecycle is specific to how TerraWars records a walk (doc 07 Phase 2).
 */
class WalkTrackerPackage : ReactPackage {

  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(WalkTrackerModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
