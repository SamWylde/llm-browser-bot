# Analysis Commands

Commands run while gathering context for the enhancement/refactor analysis:

- `ls`
- `find .. -name AGENTS.md -print`
- `rg -n "TODO|FIXME|@todo|@fixme" .`
- `cat README.md`
- `ls server`
- `cat INITIAL_PRODUCT_SPEC.md`
- `ls server/src`
- `sed -n '1,200p' server/src/index.ts`
- `sed -n '1,200p' server/src/browser-command-handler.ts`
- `sed -n '1,200p' server/src/browser-websocket-manager.ts`
- `sed -n '200,400p' server/src/browser-websocket-manager.ts`
- `ls extension`
- `sed -n '1,200p' extension/panel.js`
- `sed -n '200,400p' extension/panel.js`
- `ls test-app`
- `sed -n '1,200p' test-app/index.html`
- `sed -n '1,200p' test-app/renderer.js`
- `nl -ba README.md | sed -n '1,240p'`
- `nl -ba README.md | sed -n '240,520p'`
- `nl -ba INITIAL_PRODUCT_SPEC.md | sed -n '1,240p'`
- `nl -ba server/src/index.ts | sed -n '1,240p'`
- `nl -ba server/src/browser-command-handler.ts | sed -n '1,260p'`
- `nl -ba server/src/browser-websocket-manager.ts | sed -n '1,260p'`
- `nl -ba extension/panel.js | sed -n '1,240p'`
- `nl -ba extension/panel.js | sed -n '240,480p'`
- `nl -ba test-app/renderer.js | sed -n '1,240p'`
- `nl -ba test-app/index.html | sed -n '1,200p'`
- `rg -n "Security Considerations|Future Considerations|auth|rate limiting" INITIAL_PRODUCT_SPEC.md`
- `nl -ba INITIAL_PRODUCT_SPEC.md | sed -n '440,520p'`
- `nl -ba notes/analysis-commands.md`
