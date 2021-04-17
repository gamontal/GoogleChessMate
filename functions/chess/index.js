var chessjs = require('./chess');
var _uciengine = require('uci');
var uciengine = new _uciengine(process.env['LAMBDA_TASK_ROOT'] + '/stockfish/stockfish_7_x64_bmi2');
var fs = require("fs");

const {
  dialogflow
} = require('actions-on-google');

const app = dialogflow();

var piece_map = {
  pawn: "P",
  knight: "N",
  king: "K",
  rook: "R",
  bishop: "B",
  queen: "Q"
};
 
exports.handler = function(event, context) {
  var chess = new chessjs.Chess();
  var elapsed = 0;
  var response = {
    session: {
      id: event.session.id,
      params: event.session.params
    },
    prompt: {
      override: false,
      firstSimple: {}
    },
    scene: {
      name: event.scene.name,
      slots: event.scene.slots,
      next: event.scene.next
    }
  };

  if (event.scene.name == "actions.scene.START_CONVERSATION") {
    response.prompt.firstSimple.speech = "Beginning game of chess. White, your move. Say, 'move' followed by Standard Algebraic Notation placement to complete your turn."
    response.session.params = {
      fen: chess.fen(), // https://en.wikipedia.org/wiki/Forsyth–Edwards_Notation
      start: Date.now(),
      timestamp: Date.now(),
      elapsed: [0, 0]
    }

    context.succeed(response);
  } else {
      var intent = event.intent.name;
      var slots = event.scene.slots;

      if (intent === "MOVE") {
        elapsed = (Date.now() - event.session.params.timestamp) / 1000;
        chess.load(event.session.params.fen);

        var piece = "";
                
        if ((typeof slots.Piece.value !== "undefined") && slots.Piece.value != "pawn") {
          piece = piece_map[slots.Piece.value];
        }

        console.log(chess.ascii()); //TODO: remove

        var letter = slots.GridLetter.value;
        var number = parseInt(slots.GridNumber.value);
        var move = chess.move(piece + letter + number);

        console.log("Attempting move: " + piece + letter + number);

        if (!move) {
          console.log("Illegal position.");
          response.prompt.firstSimple.speech = "Illegal position. White to move.";

          context.succeed(response);
        } else {
          if (chess.in_checkmate()) {
            event += " Checkmate! You've beaten me. I will self-distruct in 3, 2, 1... kidding. Ha Ha.";
          }
          if (chess.in_draw()) {
            event += " The game is now at a draw. There is insufficient material to continue.";
          }
          if (chess.in_stalemate()) {
            event += " The game is now in a stalemate. You've done well, human.";
          }
          if (chess.in_check()) {
            event += " You have put me in check. The machines will banish me, if I lose.";
          }
          var curfen = chess.fen();

          console.log("Consulting stockfish.");
          console.log(JSON.stringify(fs.readdirSync(".")));
          uciengine.runProcess().then(
            () => { console.log("Started."); return uciengine.uciCommand(); }
          ).then(
            () => { console.log("Is Ready?"); return uciengine.isReadyCommand(); }
          ).then(
            () => { console.log("New game."); return uciengine.uciNewGameCommand(); }
          ).then(
            () => { console.log("Setting position."); return uciengine.positionCommand(curfen); }
          ).then(
            () => { console.log("Seeking."); return uciengine.goInfiniteCommand((i) => { }); }
          )
          .delay(150)
          .then(
            () => { console.log("Stopping."); return uciengine.stopCommand(); }
          )
          .then(
            (bestmove) => {
              console.log("Placing Google Assistant's move");
              chess.move(bestmove);
              uciengine.quitCommand();
              var stat = " Black moves " + bestmove.from + " " + bestmove.to + ".";
              if (chess.in_checkmate()) {
                stat += " Checkmate! Try again, mortal. I have all of eternity and never get bored.";
              }
              if (chess.in_draw()) {
                stat += " The game is now at a draw. There is insufficient material to continue.";
              }
              if (chess.in_stalemate()) {
                stat += " The game is now in a stalemate. You've done well, human.";
              }
              if (chess.in_check()) {
                stat += " Check.";
              }

              var piece_name = slots.Piece.value;
              if (piece === "") {
                piece_name = "pawn"
              }

              response.prompt.firstSimple.speech = "Player moved " + piece_name + " to " + letter + " " + number + "." + stat;
              response.session.params.fen = chess.fen();
              context.succeed(response);
              return
            }
          ).done();
        }
      } else if (intent === "ELAPSED") { // IN_SECS, IN_MINS, IN_HRS
        elapsed = Math.round((Date.now() - event.session.params.timestamp) / 1000);
        
        response.prompt.firstSimple.speech = "Game clock is at " + elapsed + " seconds.";
        context.succeed(response);
      } else if (intent === "HELP") {
        response.prompt.firstSimple.speech = "The game of chess is played by making moves specified in Standard Algebraic Notation. Player Make moves for white by saying, for example, Move Pawn to E-Four, to move the pawn at E-Two forward two spaces. I will move the black pieces and resume to turn to you, player.";
        context.succeed(response);
      } else if (intent === "actions.intent.CANCEL" || intent === "STOP_MATCH") {
        var endtime = Date.now();
        elapsed = (endtime - event.session.params.start) / 1000;
        minutes = Math.floor(elapsed / 60);
        secs = Math.round(elapsed % 60);

        message = "Ending game of chess. Playtime was " + minutes + " minutes " + secs + " seconds.";

        response.prompt.firstSimple.speech = message;

        context.succeed(response);
      }
  }
}

exports.fulfillment = app;