import { render } from 'preact';
import { App } from '@/ui/App';
import '@/styles/theme.css';
import '@/styles/app.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('App root element was not found.');
}

render(<App />, root);
