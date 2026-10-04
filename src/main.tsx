import { render } from 'preact';
import { App } from '@/ui/App';
import { startRouter } from '@/ui/router';
import '@/styles/theme.css';
import '@/styles/layout.css';
import '@/styles/app.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('App root element was not found.');
}

// Importing App loads the store, which installs the "no game → start" route guard, so the
// initial hash is already guarded here.
startRouter();
render(<App />, root);
