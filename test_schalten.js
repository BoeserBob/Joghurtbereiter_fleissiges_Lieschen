const fs = require('fs');
const vm = require('vm');

// Simple sandbox to simulate Shelly environment
const sandbox = {
  console: console,
  print: (...args) => console.log(...args),
  Timer: {
    set: function (ms, repeat, cb) {
      // store timers for manual invocation in tests
      if (!sandbox.__timers__) sandbox.__timers__ = [];
      sandbox.__timers__.push({ ms, repeat, cb });
      // don't actually set intervals; return a mock id
      return { id: sandbox.__timers__.length - 1 };
    },
  },
  Shelly: {
    _state: {},
    call: function (method, params, cb) {
      console.log('[Shelly.call]', method, JSON.stringify(params));
      // simulate Switch.Set effect
      if (method === 'Switch.Set' && params && typeof params.id !== 'undefined') {
        sandbox.Shelly._state[params.id] = params.on;
      }
      if (cb) cb({}, 0, 'ok', null);
    },
    getComponentConfig: function (name) {
      if (name === 'ble') return { enable: true };
      return {};
    },
  },
  BLE: {
    Scanner: {
      INFINITE_SCAN: -1,
      SCAN_RESULT: 'scan_result',
      _running: false,
      isRunning: function () { return this._running; },
      Start: function (opts) {
        this._running = true;
        return { started: true };
      },
      Subscribe: function (cb) {
        sandbox.__ble_callback__ = cb;
      }
    }
  },
  // Node Buffer available via global
  Buffer: Buffer,
  // console.log as fallback
};

// read schalten.js and run in sandbox
const code = fs.readFileSync('schalten.js', 'utf8');
vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox, { filename: 'schalten.js' });
  console.log('schalten.js geladen.');
} catch (e) {
  console.error('Fehler beim Laden:', e);
  process.exit(1);
}

// Build a BTHome v2 buffer: dib(2<<5), pid(0x00), pid val, battery, temperature (int16 LE)
const dib = (2 << 5) | 0;
const pid = 123;
const battery = 85; // %
const temp_celsius = 42.5; // target temperature
const temp_raw = Math.round(temp_celsius / 0.01); // 4250
const temp_lo = temp_raw & 0xff;
const temp_hi = (temp_raw >> 8) & 0xff;
const bytes = [dib, 0x00, pid, 0x01, battery, 0x02, temp_lo, temp_hi];
const buf = Buffer.from(bytes);

// simulate BLE scan result
const result = {
  addr: '0c:ef:f6:f2:40:d4',
  service_data: {
    'fcd2': buf
  }
};

console.log('Simuliere BLE-Scan-Callback mit Temperatur', temp_celsius, '°C und Batterie', battery, '%');
if (typeof sandbox.__ble_callback__ === 'function') {
  sandbox.__ble_callback__(sandbox.BLE.Scanner.SCAN_RESULT, result);
  // Wenn die Decoder-Pipeline in der Sandbox nicht mit Buffer arbeitet,
  // rufen wir direkt `checkBlu` mit aufgebauten Werten auf.
  if (typeof sandbox.checkBlu === 'function') {
    const unpacked = { address: result.addr, temperature: temp_celsius, battery: battery };
    sandbox.checkBlu(unpacked);
  }
} else {
  console.error('BLE callback nicht registriert');
}

// invoke timer handlers (if any) to run schalten()
if (sandbox.__timers__ && sandbox.__timers__.length > 0) {
  console.log('Führe Timer-Handler aus (Test-Modus)');
  sandbox.__timers__.forEach(t => {
    try { t.cb(); } catch (e) { console.error('Timer callback Fehler:', e); }
  });
} else {
  console.log('Keine Timer registriert');
}

console.log('Shelly state:', sandbox.Shelly._state);
console.log('Test abgeschlossen.');
