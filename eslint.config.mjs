import next from 'eslint-config-next/core-web-vitals';

const config = [...next, { ignores: ['.next/**', 'public/sw.js', 'public/sw.js.map'] }, { files: ['app/page.jsx', 'app/image-entry.jsx'], rules: { 'react-hooks/set-state-in-effect': 'off', 'react-hooks/preserve-manual-memoization': 'off' } }];
export default config;
