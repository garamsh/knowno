import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../design/app_button.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';

/// Where the terms of service are published, on the web app.
final termsOfServiceUrl = Uri.parse('https://knowno.app/terms');

/// Where the privacy policy is published, on the web app.
final privacyPolicyUrl = Uri.parse('https://knowno.app/privacy');

/// Opens a URL outside the app, resolving to whether it opened.
typedef LinkOpener = Future<bool> Function(Uri uri);

/// How a link leaves the app: the platform's browser, unless a test
/// substitutes it.
final linkOpenerProvider = Provider<LinkOpener>(
  (ref) => (uri) async {
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on PlatformException {
      return false;
    }
  },
);

/// Opens [uri] outside the app. A link that does not open is said in a snack
/// bar.
Future<void> openLegalLink(BuildContext context, WidgetRef ref, Uri uri) async {
  final messenger = ScaffoldMessenger.of(context);
  final l10n = AppLocalizations.of(context);
  final opened = await ref.read(linkOpenerProvider)(uri);
  if (!opened) {
    messenger.showSnackBar(SnackBar(content: Text(l10n.linkNotOpened)));
  }
}

/// The terms of service and the privacy policy as two quiet links, each
/// opening its document outside the app.
class LegalLinksRow extends ConsumerWidget {
  const LegalLinksRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    Widget link(String title, Uri uri) => AppButton(
      label: title,
      variant: AppButtonVariant.link,
      onPressed: () => openLegalLink(context, ref, uri),
    );
    return Wrap(
      alignment: WrapAlignment.center,
      spacing: AppSpace.s8,
      children: [
        link(l10n.termsOfService, termsOfServiceUrl),
        link(l10n.privacyPolicy, privacyPolicyUrl),
      ],
    );
  }
}
