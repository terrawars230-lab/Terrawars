# ─────────────────────────────────────────────────────────────────────────────
# R8 rules for the TerraWars release build.
#
# React Native and every autolinked library ship their own consumer rules, so
# this file only covers what is specific to this app. Each rule says why it
# exists; a rule nobody can explain is a rule nobody dares remove.
# ─────────────────────────────────────────────────────────────────────────────

# react-native-config reads the .env values from this class by reflection
# (Class.forName("com.terrawars.BuildConfig")). Renamed or stripped by R8, the
# app finds no SUPABASE_URL at launch and src/core/config/env.ts throws —
# a crash on every start of every release build.
-keep class com.terrawars.BuildConfig { *; }

# The WalkTracker native module and foreground service are app code, reached
# from JS by name and from the manifest by class name. React Native's rules
# keep @ReactMethod members; keeping the classes whole is cheap insurance for
# a component that has to work first time on a walk.
-keep class com.terrawars.location.** { *; }

# Readable stack traces in Play Console crash reports. Upload the mapping file
# (android/app/build/outputs/mapping/release/mapping.txt) with each release so
# Play can de-obfuscate them.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
