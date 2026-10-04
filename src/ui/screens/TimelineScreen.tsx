import { ScreenNav } from './ScreenNav';

export function TimelineScreen() {
  return (
    <section class="screen" aria-labelledby="timeline-title">
      <h2 id="timeline-title">Timeline</h2>
      <p>Individual boards, action drafting, and time-travel targeting will live here.</p>
      <ScreenNav current="timeline" />
    </section>
  );
}
