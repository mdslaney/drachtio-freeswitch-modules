const Srf = require('drachtio-srf');
const srf = new Srf();
const Mrf = require('drachtio-fsmrf');
const mrf = new Mrf(srf);
const config = require('config');
const projectId = config.get('dialogflow.project');
const lang = config.get('dialogflow.lang');
const startEvent = config.get('dialogflow.event');

srf.connect(config.get('drachtio'))
  .on('connect', (err, hp) => console.log(`connected to sip on ${hp}`))
  .on('error', (err) => console.log(err, 'Error connecting'));

mrf.connect(config.get('freeswitch'))
  .then((ms) => run(ms));

function run(ms) {
  srf.invite((req, res) => {
    ms.connectCaller(req, res)
      .then(({endpoint, dialog}) => {
        dialog.on('destroy', () => endpoint.destroy());
        setHandlers(endpoint, dialog);
        endpoint.api('dialogflow_start', `${endpoint.uuid} ${projectId} ${lang} 30 ${startEvent}`);
      })
      .catch((err) => {
        console.log(err, 'Error connecting call to freeswitch');
      });
  });
}

function setHandlers(ep, dlg) {
  ep.addCustomEventListener('dialogflow::intent', onIntent.bind(null, ep, dlg) );
  ep.addCustomEventListener('dialogflow::transcription', onTranscription);
  ep.addCustomEventListener('dialogflow::audio_provided', onAudioProvided.bind(null, ep, dlg));
  ep.addCustomEventListener('dialogflow::end_of_utterance', onEndOfUtterance);
  ep.addCustomEventListener('dialogflow::error', onError);
}

// event handler: we just received an intent
//  action: if 'end_interaction' is true, end the dialog after playing the final prompt
//  (or in 1 second if there is no final prompt)
function onIntent(ep, dlg, evt) {
  const responseId = evt.response_id;
  console.log(`got intent ${responseId}: ${JSON.stringify(evt)}`);
  if (responseId.length === 0) {
    console.log('no intent was detected, reprompt...');
    ep.api('dialogflow_start', `${ep.uuid} ${projectId} ${lang} 30 actions_intent_NO_INPUT`);
  }
  else {
    if (evt.query_result.intent.end_interaction) {
      this.hangupAfterPlayDone = true;
      this.waitingForPlayStart = true;
      setTimeout(() => {
        if (this.waitingForPlayStart) dlg.destroy();
      }, 1000);
    }
  }
}

// event handler: we just received a transcription
//    action: nothing, just log the transcription if this was a final transcription
function onTranscription(transcription) {
  if (transcription.recognition_result.is_final) {
    console.log(`got transcription: ${JSON.stringify(transcription)}`);
  }
}

// event handler: we just got an audio clip we can play
//    action: play the clip, and when it ends send another DialogIntentRequest
async function onAudioProvided(ep, dlg, evt) {
  console.log(`got audio file to play: ${evt.path}`);
  ep.waitingForPlayStart = false;
  await ep.play(evt.path);
  if (ep.hangupAfterPlayDone) dlg.destroy();
  else ep.api('dialogflow_start', `${ep.uuid} ${projectId} ${lang} 30`);
}

// event handler: speaker just completed saying something
//    action: nothing, just log the event
function onEndOfUtterance(evt) {
  console.log(`got end of utterance: ${JSON.stringify(evt)}`);
}

// event handler: dialog flow error of some kind
//    action: just log it
function onError(evt) {
  console.log(`got error: ${JSON.stringify(evt)}`);
}
