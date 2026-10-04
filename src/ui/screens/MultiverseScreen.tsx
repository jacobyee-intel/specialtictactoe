import { ScreenNav } from './ScreenNav';

export function MultiverseScreen() {
  return (
    <section class="screen" aria-labelledby="multiverse-title">
      <h2 id="multiverse-title">Multiverse</h2>
      <p>The branching timeline tree will live here, eventually laid out on a hyperbolic disk.</p>
      <ScreenNav current="multiverse" />
    </section>
  );
}
