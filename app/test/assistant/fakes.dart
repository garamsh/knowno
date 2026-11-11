import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:knowno/assistant/assistant.dart';
import 'package:knowno/assistant/src/assistant_client.dart';
import 'package:knowno/assistant/src/conversation.dart';
import 'package:knowno/assistant/src/protocol.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

/// What a scripted message does when it is sent: answers with an outcome.
typedef Script = SendOutcome Function(Future<void> abort);

/// A reply that streams [events] and ends.
Script reply(List<AssistantEvent> events) =>
    (_) => SendStarted(Stream.fromIterable(events));

/// A reply of the one line [text].
Script textReply(String text) => reply([TextDelta(text)]);

/// A reply the test feeds through [controller], so it can stop mid-way; a
/// stop ends its stream as the HTTP client's does, with an abort.
Script streaming(StreamController<AssistantEvent> controller) => (abort) {
  unawaited(
    abort.then((_) {
      if (controller.isClosed) return null;
      controller.addError(http.RequestAbortedException());
      return controller.close();
    }),
  );
  return SendStarted(controller.stream);
};

/// A message refused for [refusal].
Script refuse(MessageRefusal refusal) =>
    (_) => SendRefused(refusal);

/// An assistant that answers each message with the next of [scripts], records
/// every message and commit it is sent, and answers commits with [commitWith].
final class FakeAssistantClient implements AssistantClient {
  FakeAssistantClient({List<Script> scripts = const []})
    : scripts = [...scripts];

  final List<Script> scripts;
  final sent = <List<Map<String, Object?>>>[];

  /// The photos uploaded, by id, and whether an upload is kept.
  final uploaded = <String, Uint8List>{};
  var uploadsWork = true;

  /// What each poll of a photo job answers, in order; a failed poll once none
  /// is left. The jobs cancelled, and whether a cancel is kept.
  final polls = <JobPollOutcome>[];
  final cancelled = <String>[];
  var cancelWorks = true;
  final commits = <({Proposal proposal, Map<String, List<String>> checked})>[];

  /// What a commit answers.
  CommitOutcome Function(Proposal proposal) commitWith = (proposal) =>
      Committed(
        Added(
          deckId: proposal.deckId ?? 'new-deck',
          deckName: proposal.deckName,
          count: 2,
        ),
      );

  /// What the day's tokens read as; null for unreadable.
  Allowance? tokens = const Allowance(budget: 200000, used: 50000);

  /// Holds a commit until it completes, when set.
  Completer<void>? commitGate;

  @override
  Future<SendOutcome> send(
    List<Map<String, Object?>> messages, {
    required Future<void> abort,
  }) async {
    sent.add(messages);
    return scripts.removeAt(0)(abort);
  }

  @override
  Future<bool> uploadPhoto(String photoId, Uint8List bytes) async {
    if (uploadsWork) uploaded[photoId] = bytes;
    return uploadsWork;
  }

  @override
  Future<JobPollOutcome> pollJob(String id) async =>
      polls.isEmpty ? const JobPollFailed() : polls.removeAt(0);

  @override
  Future<bool> cancelJob(String id) async {
    if (cancelWorks) cancelled.add(id);
    return cancelWorks;
  }

  @override
  Future<CommitOutcome> commit(
    Proposal proposal,
    Map<String, List<String>> checked,
  ) async {
    commits.add((proposal: proposal, checked: checked));
    await commitGate?.future;
    return commitWith(proposal);
  }

  @override
  Future<Allowance?> allowance() async => tokens;
}

/// A text card of [front] and [back], as `add_cards` takes it.
Map<String, Object?> textCard(String front, String back) => {
  'blocks': [
    {'type': 'text', 'front': front, 'back': back},
  ],
};

/// A proposal of new cards for a new note [name], its groups each
/// `(title, form, cards)` and its cards numbered from [id].
Proposal proposalOf({
  String id = 'p1',
  String name = '영단어',
  String? deckId,
  ProposalKind kind = ProposalKind.cards,
  required List<(String, CardForm, List<(String, String)>)> groups,
}) => Proposal(
  id: id,
  kind: kind,
  deckId: deckId,
  deckName: name,
  groups: [
    for (final (i, (title, form, cards)) in groups.indexed)
      ProposalGroup(
        id: 'g$i',
        title: title,
        form: form,
        cards: [
          for (final (j, (front, back)) in cards.indexed)
            ProposalCard(id: 'g$i-c$j', card: textCard(front, back)),
        ],
      ),
  ],
);

/// Device storage over memory, opened as the composition site opens it,
/// holding [values].
Future<SharedPreferencesWithCache> openAssistantStorage(
  WidgetTester tester, [
  Map<String, Object> values = const {},
]) async {
  SharedPreferencesAsyncPlatform.instance =
      InMemorySharedPreferencesAsync.withData(values);
  return (await tester.runAsync(
    () => SharedPreferencesWithCache.create(
      cacheOptions: const SharedPreferencesWithCacheOptions(
        allowList: assistantStorageKeys,
      ),
    ),
  ))!;
}

/// The notes the chat was asked to open.
final opened = <String>[];

/// Pumps the chat over [client] and [storage], in English, with a note that
/// opens as a screen of its own, which [opened] records.
Future<ProviderContainer> pumpChat(
  WidgetTester tester,
  FakeAssistantClient client,
  SharedPreferencesWithCache storage, {
  ThemeMode themeMode = ThemeMode.light,
  double textScale = 1,
  PhotoSource? photoSource,
}) async {
  opened.clear();
  final container = ProviderContainer(
    overrides: [
      assistantClientProvider.overrideWithValue(client),
      assistantStorageProvider.overrideWithValue(storage),
      assistantPhotoSourceProvider.overrideWithValue(photoSource),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: themeMode,
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => AssistantChatScreen(
                  openNote: (context, deckId) async {
                    opened.add(deckId);
                    await Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => Scaffold(
                          appBar: AppBar(),
                          body: Text('note $deckId'),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
            child: const Text('open chat'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open chat'));
  await tester.pumpAndSettle();
  return container;
}

/// The device's storage of a chat whose one finished reply holds a proposal
/// of three cards in two groups, for new cards or, with [changes], for the
/// note `deck0`; [added] once its cards were added to that note.
Map<String, Object> storedChatWithProposal({
  bool changes = false,
  ({String id, String name})? added,
}) {
  final proposal = proposalOf(
    deckId: changes ? 'deck0' : null,
    kind: changes ? ProposalKind.changes : ProposalKind.cards,
    groups: [
      ('A', CardForm.text, [('a', 'b'), ('c', 'd')]),
      ('B', CardForm.text, [('e', 'f')]),
    ],
  );
  return {
    'assistant.conversation': Conversation(
      turns: [
        const UserTurn(id: 'u', text: '만들어 줘'),
        AssistantTurn(
          id: 'a',
          text: '만들었어요',
          proposals: [
            ShownProposal.of(proposal).copyWith(
              added: added == null
                  ? null
                  : Added(deckId: added.id, deckName: added.name, count: 3),
            ),
          ],
          ending: Ending.ok,
        ),
      ],
    ).encode(),
  };
}

/// The device's storage of a chat for the screenshots: a request for a note's
/// cards answered with a proposal of three groups in three forms, one of them
/// long enough to collapse; [added] once added to a note, [job] with a photo
/// job still reading under a reply, and a reply that asks a question when
/// [ask].
Map<String, Object> storedChatShowcase({
  ({String id, String name})? added,
  ({int finished, int photos})? job,
  bool ask = false,
}) {
  final proposal = Proposal(
    id: 'p',
    kind: ProposalKind.cards,
    deckId: null,
    deckName: '영단어 기본',
    groups: [
      ProposalGroup(
        id: 'g0',
        title: '1단원 기본 단어',
        form: CardForm.text,
        cards: [
          for (final (i, (front, back)) in [
            ('ephemeral', '덧없는, 순간적인'),
            ('meticulous', '꼼꼼한, 세심한'),
            ('ubiquitous', '어디에나 있는'),
          ].indexed)
            ProposalCard(id: 'g0-$i', card: textCard(front, back)),
        ],
      ),
      ProposalGroup(
        id: 'g1',
        title: '2단원 빈칸 문장',
        form: CardForm.cloze,
        cards: [
          for (final (i, text) in [
            'The cat is {{c1::ephemeral}}.',
            'She is {{c1::meticulous}} about details.',
          ].indexed)
            ProposalCard(
              id: 'g1-$i',
              card: {
                'blocks': [
                  {
                    'type': 'cloze',
                    'text': text,
                    'answers': [
                      ['x'],
                    ],
                  },
                ],
              },
            ),
        ],
      ),
      ProposalGroup(
        id: 'g2',
        title: '3단원 동사 활용',
        form: CardForm.table,
        cards: [
          for (var i = 0; i < 7; i++)
            ProposalCard(id: 'g2-$i', card: textCard('verb $i', '동사 $i')),
        ],
      ),
    ],
  );
  return {
    'assistant.conversation': Conversation(
      turns: [
        const UserTurn(id: 'u0', text: '1단원 단어는 단어로, 2단원은 빈칸 문장으로 만들어 줘'),
        AssistantTurn(
          id: 'a0',
          text: '알겠어요. 단원별로 나눠서 만들었어요. 카드는 모두 12장이에요.',
          proposals: [
            ShownProposal.of(proposal).copyWith(
              added: added == null
                  ? null
                  : Added(deckId: added.id, deckName: added.name, count: 12),
            ),
          ],
          choice: ask
              ? const Choice(
                  prompt: '이어서 무엇을 할까요?',
                  options: ['표로 바꾸기', '더 만들기'],
                )
              : null,
          ending: Ending.ok,
        ),
        if (job != null) ...[
          const UserTurn(id: 'u1', text: '', photos: ['a', 'b']),
          AssistantTurn(
            id: 'a1',
            text: '사진을 읽을게요.',
            ending: Ending.ok,
            job: JobProgress(
              id: 'job-1',
              photos: job.photos,
              finished: job.finished,
            ),
          ),
        ],
      ],
    ).encode(),
  };
}

/// A reply the test writes into as it goes, then ends.
final class LiveReply {
  final _controller = StreamController<AssistantEvent>();

  Script get script => streaming(_controller);

  void text(String text) => _controller.add(TextDelta(text));

  Future<void> end() => _controller.close();
}

/// A reply of [text] that ends in a question with quick-reply [options].
Script questionReply(String text, String prompt, List<String> options) => reply(
  [TextDelta(text), ChoiceEvent(Choice(prompt: prompt, options: options))],
);

/// A reply of [text] that failed at the model.
Script failedReply(String text) =>
    reply([TextDelta(text), const ErrorEvent(ReplyError.modelError)]);

/// A message refused because the day's tokens are used.
Script spentRefusal() =>
    refuse(const RateLimited(Allowance(budget: 200, used: 200)));

/// A message refused because the one before it still runs.
Script busyRefusal() => refuse(const Busy());
