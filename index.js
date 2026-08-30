/**
 * @format
 *
 * Entry point. `react-native-gesture-handler` must be imported before anything
 * else in the app so its native handlers are installed before the first view
 * is mounted.
 */
import 'react-native-gesture-handler';

import {AppRegistry} from 'react-native';

import App from './src/app/App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
