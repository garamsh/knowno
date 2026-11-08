import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/src/card_preview.dart';

void main() {
  test('reads each card form in two lines', () {
    expect(
      previewOf({
        'front': ' apple ',
        'back': '사과',
        'labels': ['명'],
      }),
      (front: 'apple', back: '[명] 사과', photo: false),
    );
    expect(
      previewOf({
        'blocks': [
          {'type': 'text', 'front': 'Q', 'back': 'A'},
        ],
      }),
      (front: 'Q', back: 'A', photo: false),
    );
    expect(
      previewOf({
        'blocks': [
          {
            'type': 'senses',
            'term': 'run',
            'senses': [
              {
                'labels': ['동'],
                'meaning': '달리다',
              },
              {'meaning': '운영하다'},
            ],
          },
        ],
      }),
      (front: 'run', back: '[동] 달리다 · 운영하다', photo: false),
    );
    expect(
      previewOf({
        'blocks': [
          {
            'type': 'cloze',
            'text': '{{c1::서울}}은 수도',
            'answers': [
              ['서울', 'Seoul'],
              '수도',
            ],
          },
        ],
      }),
      (front: '{{c1::서울}}은 수도', back: '서울/Seoul, 수도', photo: false),
    );
    expect(
      previewOf({
        'blocks': [
          {
            'type': 'table',
            'columns': ['나라', '수도'],
            'rows': [
              ['한국', '서울'],
              ['일본', '도쿄'],
            ],
          },
        ],
      }),
      (front: '나라 · 수도', back: '한국 · 서울 / 일본 · 도쿄', photo: false),
    );
  });

  test('marks a photo card and reads a block it does not know as empty', () {
    expect(
      previewOf({
        'blocks': [
          {'type': 'image'},
        ],
      }).photo,
      isTrue,
    );
    expect(
      previewOf({
        'blocks': [
          {'type': 'mystery'},
        ],
      }),
      (front: '', back: '', photo: false),
    );
  });
}
