import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/src/protocol.dart';

String _json(Object? value) => jsonEncode(value);

Map<String, Object?> _proposal() => {
  'id': 'p1',
  'kind': 'cards',
  'deck': {'id': null, 'name': '영단어'},
  'groups': [
    {
      'id': 'g0',
      'title': '1단원',
      'format': 'cloze',
      'cards': [
        {
          'id': 'c0',
          'card': {'blocks': <Object?>[]},
        },
      ],
    },
  ],
};

void main() {
  group('parseEvent', () {
    test('reads each event the stream sends', () {
      expect(
        parseEvent('text', _json({'delta': '안녕'})),
        isA<TextDelta>().having((e) => e.delta, 'delta', '안녕'),
      );
      expect(
        parseEvent('citation', _json({'url': 'https://a.b', 'title': 'A'})),
        isA<CitationEvent>().having((e) => e.url, 'url', 'https://a.b'),
      );
      expect(
        parseEvent('proposal', _json(_proposal())),
        isA<ProposalEvent>().having(
          (e) => e.proposal.groups.single.form,
          'form',
          CardForm.cloze,
        ),
      );
      expect(
        parseEvent(
          'choice',
          _json({
            'prompt': '형식은?',
            'options': ['단어', '표'],
          }),
        ),
        isA<ChoiceEvent>().having((e) => e.choice.options, 'options', [
          '단어',
          '표',
        ]),
      );
      expect(
        parseEvent('error', _json({'error': 'cut'})),
        isA<ErrorEvent>().having((e) => e.error, 'error', ReplyError.cut),
      );
      expect(
        parseEvent(
          'usage',
          _json({'outcome': 'ok', 'token_budget': 200, 'tokens_used': 50}),
        ),
        isA<UsageEvent>().having((e) => e.allowance.leftShare, 'share', 75),
      );
    });

    test('reads the interim mark, whatever its data holds', () {
      expect(parseEvent('interim', _json({})), isA<InterimEvent>());
      expect(parseEvent('interim', 'not json'), isA<MalformedEvent>());
    });

    test('reads a job event at the boundary and keeps nothing of it', () {
      expect(
        parseEvent(
          'job',
          _json({'id': 'j1', 'photos': 12, 'status': 'running'}),
        ),
        isA<JobEvent>()
            .having((e) => e.id, 'id', 'j1')
            .having((e) => e.photos, 'photos', 12),
      );
      // Control: a job without its photos is not one.
      expect(parseEvent('job', _json({'id': 'j1'})), isA<MalformedEvent>());
    });

    test('tells a name it does not draw from a known one with bad data', () {
      expect(parseEvent('ping', '{}'), isNull);
      expect(parseEvent('text', 'not json'), isA<MalformedEvent>());
      expect(parseEvent('text', _json({'delta': 3})), isA<MalformedEvent>());
      expect(
        parseEvent('error', _json({'error': 'other'})),
        isA<MalformedEvent>(),
      );
      expect(
        parseEvent('choice', _json({'prompt': 'q', 'options': <String>[]})),
        isA<MalformedEvent>(),
      );
    });

    test('refuses a proposal with an unknown form or no group', () {
      final badForm = _proposal();
      ((badForm['groups']! as List<Object?>).single!
              as Map<String, Object?>)['format'] =
          'poem';
      expect(parseEvent('proposal', _json(badForm)), isA<MalformedEvent>());
      expect(
        parseEvent('proposal', _json({..._proposal(), 'groups': <Object?>[]})),
        isA<MalformedEvent>(),
      );
    });

    test('reads a proposal for an existing note with its id', () {
      final proposal = Proposal.parse({
        ..._proposal(),
        'deck': {'id': 'd1', 'name': 'N'},
      });
      expect(proposal?.deckId, 'd1');
    });
  });

  group('parseRefusal', () {
    test('tells a spent budget from a message still running', () {
      expect(
        parseRefusal(
          429,
          _json({
            'error': 'rate_limited',
            'token_budget': 100,
            'tokens_used': 100,
          }),
        ),
        isA<RateLimited>().having((r) => r.allowance?.leftShare, 'share', 0),
      );
      expect(parseRefusal(429, _json({'error': 'busy'})), isA<Busy>());
    });

    test('maps each other status', () {
      expect(parseRefusal(401, '{}'), isA<SignInNeeded>());
      expect(parseRefusal(403, '{}'), isA<Suspended>());
      expect(parseRefusal(413, '{}'), isA<TooLong>());
      expect(parseRefusal(503, 'oops'), isA<Unavailable>());
    });
  });

  test('the share left rounds down and is null without a budget', () {
    expect(const Allowance(budget: 3, used: 1).leftShare, 66);
    expect(const Allowance(budget: 10, used: 40).leftShare, 0);
    expect(const Allowance(budget: null, used: 40).leftShare, isNull);
  });
}
