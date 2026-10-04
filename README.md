# Multiverse Tic-Tac-Toe in Impossible Spaces

3D tic-tac-toe played on impossible spaces: the 3-torus, quarter-turn space, the first amphicosm, and the surface of a tesseract.

This is 3-Dimensional Non-Euclidean Multiversal Tesseract Time Travel Tic Tac Toe with Parallel Universe Transfer and Timeline Splitting.

It's as simple as it sounds.

## Play it

https://jacobyee-intel.github.io/specialtictactoe/

## How to play

Two players share one screen. Player 1 is red squares, Player 2 is blue circles.

1. **Pick a space and a size.** N is the number of cells per side, M is how many in a row win a timeline, W is how many timelines you must win, and L is the round limit.
2. **Every timeline where it is your move needs an action.** On each one, choose:
   - **Place:** put a mark on an empty cell.
   - **Split:** copy the board into two timelines, where your opponent moves first.
   - **Time travel:** send one of your marks back to an earlier board where it was your move. The past board branches into a new timeline.
   - **Transfer:** move one of your marks sideways onto another timeline at the same step.

     This readies your actions for commitment in a queue.
3. **End your turn** once every timeline has an action.
4. **Win timelines.** M in a row along a straight line through the space, wins that timeline. The loser must then make a **forced send-back**: a new mark on an earlier board of that timeline.
5. **Win the game** by winning W timelines first. If L rounds pass, the game is a draw. At most 32 timelines can be live at once.

**Reading the board.** Quite intuitive, actually.

## Development

```bash
npm install
npm run dev
npm run check
npm run push
npm run deploy
```

`npm run push` pushes via `gh api` after checks pass. `npm run deploy` publishes `dist/` to the `gh-pages` branch via `gh api`.

## Docs

See [docs/](docs/).
