{
  "targets": [
    {
      "target_name": "rdp_addon",
      "sources": [
        "rdp_module.cpp",
        "rdp_session.cpp"
      ],
      "include_dirs": [
        "<!(node -e \"require('node-addon-api').include\")",
        "<!@(node -p \"
          const p = process.platform;
          if (p === 'win32') {
            const root = (process.env.VCPKG_INSTALLATION_ROOT || 'C:\\\\\\\\vcpkg').replace(/\\\\\\\\+$/,'');
            const inc = root + '\\\\\\\\installed\\\\\\\\x64-windows\\\\\\\\include\\\\\\\\freerdp2';
            console.log(inc);
          } else {
            const {execSync} = require('child_process');
            try {
              const r = execSync('pkg-config --cflags freerdp2').toString().trim();
              console.log(r.replace(/-I/g,'').split(/\\\\s+/).join('\\\\n'));
            } catch {
              console.log('');
            }
          }
        \")"
      ],
      "libraries": [
        "<!@(node -p \"
          const p = process.platform;
          if (p === 'win32') {
            const root = (process.env.VCPKG_INSTALLATION_ROOT || 'C:\\\\\\\\vcpkg').replace(/\\\\\\\\+$/,'');
            const libDir = root + '\\\\\\\\installed\\\\\\\\x64-windows\\\\\\\\lib';
            console.log(libDir + '\\\\\\\\freerdp-client2.lib');
            console.log(libDir + '\\\\\\\\freerdp2.lib');
            console.log(libDir + '\\\\\\\\winpr2.lib');
          } else {
            const {execSync} = require('child_process');
            try {
              const r = execSync('pkg-config --libs freerdp2 freerdp-client2').toString().trim();
              console.log(r.split(/\\\\s+/).join('\\\\n'));
            } catch {
              console.log('-lfreerdp-client2');
              console.log('-lfreerdp2');
              console.log('-lwinpr2');
            }
          }
        \")"
      ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_CFLAGS": ["-std=c++17"],
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }],
        ["OS=='linux'", {
          "cflags!": ["-fno-exceptions"],
          "cflags_cc!": ["-fno-exceptions"]
        }]
      ]
    }
  ]
}
