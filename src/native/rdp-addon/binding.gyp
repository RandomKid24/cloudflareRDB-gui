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
        "<!@(node -p \"if (process.platform === 'win32') { const { execSync } = require('child_process'); try { const p = execSync('where freerdp.h 2>nul').toString().trim().replace('freerdp.h', '').replace(/\\\\/g, '\\\\\\\\'); console.log(p); } catch { console.log(''); } } else { const { execSync } = require('child_process'); try { console.log(execSync('pkg-config --cflags freerdp2 2>/dev/null || echo').toString().trim().replace(/-I/g, '').split(/\\s+/).join('\\\\n')); } catch { console.log(''); } }\")"
      ],
      "libraries": [
        "<!@(node -p \"if (process.platform === 'win32') { 'freerdp-client2.lib freerdp2.lib winpr2.lib'.split(' ').join('\\\\n') } else { const { execSync } = require('child_process'); try { console.log(execSync('pkg-config --libs freerdp2 freerdp-client2 2>/dev/null || echo \\\"-lfreerdp-client2 -lfreerdp2 -lwinpr2\\\"').toString().trim().split(/\\s+/).join('\\\\n')); } catch { console.log('-lfreerdp-client2 -lfreerdp2 -lwinpr2'.split(' ').join('\\\\n')); } }\")"
      ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "freerdp-client2.lib",
            "freerdp2.lib",
            "winpr2.lib"
          ]
        }],
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
