var fs = require("fs");

//chess.js is a Javascript chess library that is used for chess move generation/validation, 
//piece placement/movement, and check/checkmate/stalemate detection - basically everything but the AI/engine.
var chessjs = require('./chess');

//https://en.wikipedia.org/wiki/Universal_Chess_Interface
//We use the Stockfish open-source chess engine to compute the program's counter moves.
var _uciEngine = require('uci');

//https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html
var uciEngine = new _uciEngine(process.env['LAMBDA_TASK_ROOT'] + '/stockfish/stockfish_7_x64_bmi2');

//https://cloud.google.com/dialogflow/es/docs/reference/libraries/nodejs
const { dialogflow } = require('actions-on-google');

//https://developers.google.com/assistant/conversational/df-asdk/reference/nodejsv2/overview
const app = dialogflow();

exports.handler = function (event, context) {
  var chess = new chessjs.Chess();

  var pieceMap = {
    knight: "N",
    king: "K",
    rook: "R",
    bishop: "B",
    queen: "Q"
  };

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
      fen: chess.fen(), //https://en.wikipedia.org/wiki/Forsyth–Edwards_Notation
      start: Date.now(),
      timestamp: Date.now(),
      elapsed: [0, 0]
    }

    context.succeed(response);
  } else {
    var intent = event.intent.name;
    var slots = event.scene.slots;

    if (intent === "MOVE_PIECE") {
      elapsed = (Date.now() - event.session.params.timestamp) / 1000;
      chess.load(event.session.params.fen);

      var piece = "";

      if (typeof slots.Piece.value != "undefined" && slots.Piece.value != "pawn") {
        piece = pieceMap[slots.Piece.value];
      }

      console.log(chess.ascii()); //TODO: remove

      var letter = slots.GridLetter.value;
      var number = parseInt(slots.GridNumber.value);
      var move = chess.move(piece+letter+number); //TODO: Implement capture logic

      console.log("Attempting move: " + piece + letter + number);

      if (!move) {
        console.log("Illegal position: " + (move));

        response.prompt.firstSimple.speech = "Illegal position: '" + piece+letter+number + "'. White to move.";
        context.succeed(response);
      } else {
        if (chess.in_checkmate()) {
          response.prompt.firstSimple.speech = "Checkmate! You've beaten me. I will self-distruct in 3, 2, 1... I'm kidding. Ha Ha.";
          context.succeed(response);
        }
        if (chess.in_draw()) {
          response.prompt.firstSimple.speech = "The game is now at a draw. There is insufficient material to continue.";
          context.succeed(response);
        }
        if (chess.in_stalemate()) {
          response.prompt.firstSimple.speech = "The game is now in a stalemate. You've done well, human.";
          context.succeed(response);
        }
        //if (chess.in_check()) {
        //  response.prompt.firstSimple.speech = " You have put me in check. The machines will banish me, if I lose.";
        //}
        var curfen = chess.fen();

        console.log("Consulting stockfish...");
        console.log(JSON.stringify(fs.readdirSync(".")));

        uciEngine.runProcess().then(
          () => { console.log("Started."); return uciEngine.uciCommand(); }
        ).then(
          () => { console.log("Is Ready?"); return uciEngine.isReadyCommand(); }
        ).then(
          () => { console.log("New game."); return uciEngine.uciNewGameCommand(); }
        ).then(
          () => { console.log("Setting position."); return uciEngine.positionCommand(curfen); }
        ).then(
          () => { console.log("Seeking."); return uciEngine.goInfiniteCommand((i) => { }); }
        ).delay(150).then(
            () => { console.log("Stopping."); return uciEngine.stopCommand(); }
          ).then(
            (bestmove) => {
              console.log("Placing counter move...");
              console.log(bestmove);
              
              chess.move(bestmove);
              uciEngine.quitCommand();
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

              var pieceName = slots.Piece.value;
              if (piece === "") {
                pieceName = "pawn"
              }

              response.prompt.firstSimple.speech = "Player moved " + pieceName + " to " + letter + " " + number + "." + stat;
              response.session.params.fen = chess.fen();
              context.succeed(response);
              return
            }
          ).done();
      }
    } else if (intent === "ELAPSED_GAME_TIME") {
      elapsed = Math.round((Date.now() - event.session.params.timestamp) / 1000);

      response.prompt.firstSimple.speech = "Game clock is at " + elapsed + " seconds.";
      context.succeed(response);
    } else if (intent === "HELP") {
      response.prompt.firstSimple.speech = "The game of chess is played by making moves specified in Standard Algebraic Notation. Player Make moves for white by saying, for example, Move Pawn to E-Four, to move the pawn at E-Two forward two spaces. I will move the black pieces and resume to turn to you, player.";
      context.succeed(response);
    } else if (intent === "actions.intent.CANCEL" || intent === "STOP_GAME") {
      var endtime = Date.now();
      var elapsed = (endtime - event.session.params.start) / 1000;
      var minutes = Math.floor(elapsed / 60);
      var secs = Math.round(elapsed % 60);

      response.prompt.firstSimple.speech = "Ending game of chess. Playtime was " + minutes + " minutes " + secs + " seconds.";
      context.succeed(response);
    }
  }
}

exports.fulfillment = app;