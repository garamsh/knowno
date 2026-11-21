import AuthenticationServices
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "AppleSignInButton") {
      registrar.register(
        AppleSignInButtonFactory(messenger: registrar.messenger()),
        withId: AppleSignInButtonFactory.viewType)
    }
  }
}

/// Makes the sign-in screen's Apple button: the system's `ASAuthorizationAppleIDButton`.
final class AppleSignInButtonFactory: NSObject, FlutterPlatformViewFactory {
  static let viewType = "app.knowno/apple-sign-in-button"

  private let messenger: FlutterBinaryMessenger

  init(messenger: FlutterBinaryMessenger) {
    self.messenger = messenger
    super.init()
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    FlutterStandardMessageCodec.sharedInstance()
  }

  func create(
    withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?
  ) -> FlutterPlatformView {
    AppleSignInButtonView(frame: frame, viewId: viewId, arguments: args, messenger: messenger)
  }
}

/// The button, type continue, white when `dark` is set and black otherwise, with the radius
/// Dart sends; a tap calls `pressed` on the channel named for the view.
final class AppleSignInButtonView: NSObject, FlutterPlatformView {
  private let button: ASAuthorizationAppleIDButton
  private let channel: FlutterMethodChannel

  init(frame: CGRect, viewId: Int64, arguments args: Any?, messenger: FlutterBinaryMessenger) {
    let params = args as? [String: Any]
    let dark = params?["dark"] as? Bool ?? false
    button = ASAuthorizationAppleIDButton(
      authorizationButtonType: .continue,
      authorizationButtonStyle: dark ? .white : .black)
    button.frame = frame
    button.cornerRadius = CGFloat(params?["radius"] as? Double ?? 24)
    channel = FlutterMethodChannel(
      name: "\(AppleSignInButtonFactory.viewType)/\(viewId)", binaryMessenger: messenger)
    super.init()
    button.addTarget(self, action: #selector(pressed), for: .touchUpInside)
  }

  func view() -> UIView { button }

  @objc private func pressed() {
    channel.invokeMethod("pressed", arguments: nil)
  }
}
