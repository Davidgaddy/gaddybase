import { Chessboard } from 'react-chessboard';

interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  interactive: boolean;
  onUserMove: (from: string, to: string) => boolean;
}

export function ChessBoard({ fen, orientation, interactive, onUserMove }: ChessBoardProps) {
  return (
    <div className="w-full max-w-[560px]">
      <Chessboard
        options={{
          id: 'main-board',
          position: fen,
          boardOrientation: orientation,
          allowDragging: interactive,
          animationDurationInMs: 200,
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            if (!targetSquare) return false;
            return onUserMove(sourceSquare, targetSquare);
          },
          darkSquareStyle: { backgroundColor: '#7c8a9e' },
          lightSquareStyle: { backgroundColor: '#eef1f5' },
        }}
      />
    </div>
  );
}
