package com.newsinsight.collector.util;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * ApiKeyEncryptor 단위 테스트
 * 
 * AES-256-GCM 암호화/복호화 및 마스킹 기능을 검증합니다.
 */
class ApiKeyEncryptorTest {

    private ApiKeyEncryptor encryptor;
    
    private static final String TEST_SECRET = "testSecretKeyForUnitTests123456";
    private static final String TEST_SALT = "testSaltValue16c";

    @BeforeEach
    void setUp() {
        encryptor = new ApiKeyEncryptor(TEST_SECRET, TEST_SALT);
    }

    @Nested
    @DisplayName("암호화 테스트")
    class EncryptTests {

        @Test
        @DisplayName("평문 API 키를 암호화하면 ENC: 접두사가 붙는다")
        void encryptAddsPrefix() {
            // given
            String plainApiKey = "sk-test-api-key-1234567890";

            // when
            String encrypted = encryptor.encrypt(plainApiKey);

            // then
            assertThat(encrypted).startsWith("ENC:");
            assertThat(encrypted).isNotEqualTo(plainApiKey);
        }

        @Test
        @DisplayName("동일한 평문을 암호화해도 매번 다른 결과가 나온다 (랜덤 IV)")
        void encryptProducesDifferentResultsForSameInput() {
            // given
            String plainApiKey = "sk-test-api-key-1234567890";

            // when
            String encrypted1 = encryptor.encrypt(plainApiKey);
            String encrypted2 = encryptor.encrypt(plainApiKey);

            // then
            assertThat(encrypted1).isNotEqualTo(encrypted2);
        }

        @Test
        @DisplayName("이미 암호화된 값은 다시 암호화하지 않는다")
        void encryptDoesNotDoubleEncrypt() {
            // given
            String plainApiKey = "sk-test-api-key-1234567890";
            String encrypted = encryptor.encrypt(plainApiKey);

            // when
            String doubleEncrypted = encryptor.encrypt(encrypted);

            // then
            assertThat(doubleEncrypted).isEqualTo(encrypted);
        }

        @ParameterizedTest
        @NullAndEmptySource
        @ValueSource(strings = {"   ", "\t", "\n"})
        @DisplayName("null, 빈 문자열, 공백은 그대로 반환한다")
        void encryptReturnsNullOrEmptyAsIs(String input) {
            // when
            String result = encryptor.encrypt(input);

            // then
            assertThat(result).isEqualTo(input);
        }

        @ParameterizedTest
        @ValueSource(strings = {
            "sk-1234567890abcdef",
            "sk-ant-api03-very-long-anthropic-key-here",
            "AIzaSyA-google-api-key-example",
            "pplx-perplexity-key",
            "한글이포함된API키테스트",
            "special!@#$%^&*()characters"
        })
        @DisplayName("다양한 형식의 API 키를 암호화할 수 있다")
        void encryptVariousApiKeyFormats(String apiKey) {
            // when
            String encrypted = encryptor.encrypt(apiKey);

            // then
            assertThat(encrypted).startsWith("ENC:");
        }
    }

    @Nested
    @DisplayName("복호화 테스트")
    class DecryptTests {

        @Test
        @DisplayName("암호화된 값을 복호화하면 원본을 복원한다")
        void decryptRestoresOriginal() {
            // given
            String original = "sk-test-api-key-1234567890";
            String encrypted = encryptor.encrypt(original);

            // when
            String decrypted = encryptor.decrypt(encrypted);

            // then
            assertThat(decrypted).isEqualTo(original);
        }

        @Test
        @DisplayName("암호화되지 않은 평문은 그대로 반환한다 (하위 호환성)")
        void decryptReturnsPlainTextAsIs() {
            // given
            String plainApiKey = "sk-plain-text-api-key";

            // when
            String result = encryptor.decrypt(plainApiKey);

            // then
            assertThat(result).isEqualTo(plainApiKey);
        }

        @ParameterizedTest
        @NullAndEmptySource
        @ValueSource(strings = {"   ", "\t", "\n"})
        @DisplayName("null, 빈 문자열, 공백은 그대로 반환한다")
        void decryptReturnsNullOrEmptyAsIs(String input) {
            // when
            String result = encryptor.decrypt(input);

            // then
            assertThat(result).isEqualTo(input);
        }

        @Test
        @DisplayName("잘못된 암호문은 예외를 발생시킨다")
        void decryptThrowsOnInvalidCiphertext() {
            // given
            String invalidEncrypted = "ENC:invalid-base64-data!!!";

            // when/then
            assertThatThrownBy(() -> encryptor.decrypt(invalidEncrypted))
                .isInstanceOf(RuntimeException.class);
        }

        @Test
        @DisplayName("손상된 암호문은 예외를 발생시킨다")
        void decryptThrowsOnCorruptedCiphertext() {
            // given
            String original = "sk-test-api-key";
            String encrypted = encryptor.encrypt(original);
            // 암호문의 일부를 손상
            String corrupted = encrypted.substring(0, encrypted.length() - 5) + "XXXXX";

            // when/then
            assertThatThrownBy(() -> encryptor.decrypt(corrupted))
                .isInstanceOf(RuntimeException.class);
        }

        @ParameterizedTest
        @ValueSource(strings = {
            "sk-1234567890abcdef",
            "한글이포함된API키테스트",
            "special!@#$%^&*()characters",
            "very-long-api-key-that-exceeds-typical-length-" + 
                "abcdefghijklmnopqrstuvwxyz0123456789"
        })
        @DisplayName("다양한 형식의 API 키를 암/복호화 라운드트립할 수 있다")
        void encryptDecryptRoundTrip(String original) {
            // when
            String encrypted = encryptor.encrypt(original);
            String decrypted = encryptor.decrypt(encrypted);

            // then
            assertThat(decrypted).isEqualTo(original);
        }
    }

    @Nested
    @DisplayName("isEncrypted 테스트")
    class IsEncryptedTests {

        @Test
        @DisplayName("ENC: 접두사가 있으면 암호화된 것으로 판단")
        void isEncryptedReturnsTrueForEncryptedValue() {
            // given
            String encrypted = encryptor.encrypt("test-key");

            // when/then
            assertThat(encryptor.isEncrypted(encrypted)).isTrue();
        }

        @Test
        @DisplayName("ENC: 접두사가 없으면 암호화되지 않은 것으로 판단")
        void isEncryptedReturnsFalseForPlainValue() {
            // given
            String plain = "sk-plain-api-key";

            // when/then
            assertThat(encryptor.isEncrypted(plain)).isFalse();
        }

        @Test
        @DisplayName("null은 암호화되지 않은 것으로 판단")
        void isEncryptedReturnsFalseForNull() {
            // when/then
            assertThat(encryptor.isEncrypted(null)).isFalse();
        }

        @Test
        @DisplayName("ENC:로 시작하지만 실제 암호문이 아닌 경우도 true 반환 (형식만 체크)")
        void isEncryptedChecksOnlyPrefix() {
            // given
            String fakeEncrypted = "ENC:this-is-not-real-ciphertext";

            // when/then
            assertThat(encryptor.isEncrypted(fakeEncrypted)).isTrue();
        }
    }

    @Nested
    @DisplayName("getMaskedKey 테스트")
    class GetMaskedKeyTests {

        @Test
        @DisplayName("평문 API 키를 마스킹한다")
        void maskPlainApiKey() {
            // given
            String plainApiKey = "sk-test-api-key-1234567890";

            // when
            String masked = encryptor.getMaskedKey(plainApiKey);

            // then
            assertThat(masked).isEqualTo("sk-t****7890");
        }

        @Test
        @DisplayName("암호화된 API 키를 복호화 후 마스킹한다")
        void maskEncryptedApiKey() {
            // given
            String original = "sk-test-api-key-1234567890";
            String encrypted = encryptor.encrypt(original);

            // when
            String masked = encryptor.getMaskedKey(encrypted);

            // then
            assertThat(masked).isEqualTo("sk-t****7890");
        }

        @Test
        @DisplayName("8자 미만의 짧은 키는 ****로 표시")
        void maskShortKey() {
            // given
            String shortKey = "sk-123";

            // when
            String masked = encryptor.getMaskedKey(shortKey);

            // then
            assertThat(masked).isEqualTo("****");
        }

        @Test
        @DisplayName("정확히 8자인 키도 마스킹된다")
        void maskEightCharKey() {
            // given
            String eightCharKey = "12345678";

            // when
            String masked = encryptor.getMaskedKey(eightCharKey);

            // then
            assertThat(masked).isEqualTo("1234****5678");
        }

        @ParameterizedTest
        @NullAndEmptySource
        @ValueSource(strings = {"   "})
        @DisplayName("null, 빈 문자열, 공백은 ****로 표시")
        void maskNullOrEmptyReturnsStars(String input) {
            // when
            String masked = encryptor.getMaskedKey(input);

            // then
            assertThat(masked).isEqualTo("****");
        }
    }

    @Nested
    @DisplayName("다른 키로 생성된 암호문 테스트")
    class DifferentKeyTests {

        @Test
        @DisplayName("다른 secret으로 생성된 Encryptor는 복호화에 실패한다")
        void differentSecretFailsDecryption() {
            // given
            String original = "sk-test-api-key";
            String encrypted = encryptor.encrypt(original);
            
            ApiKeyEncryptor differentEncryptor = new ApiKeyEncryptor(
                "differentSecretKey123456789012", 
                TEST_SALT
            );

            // when/then
            assertThatThrownBy(() -> differentEncryptor.decrypt(encrypted))
                .isInstanceOf(RuntimeException.class);
        }

        @Test
        @DisplayName("다른 salt로 생성된 Encryptor는 복호화에 실패한다")
        void differentSaltFailsDecryption() {
            // given
            String original = "sk-test-api-key";
            String encrypted = encryptor.encrypt(original);
            
            ApiKeyEncryptor differentEncryptor = new ApiKeyEncryptor(
                TEST_SECRET, 
                "differentSalt123"
            );

            // when/then
            assertThatThrownBy(() -> differentEncryptor.decrypt(encrypted))
                .isInstanceOf(RuntimeException.class);
        }

        @Test
        @DisplayName("동일한 키로 생성된 새 인스턴스는 복호화에 성공한다")
        void sameKeySucceedsDecryption() {
            // given
            String original = "sk-test-api-key";
            String encrypted = encryptor.encrypt(original);
            
            ApiKeyEncryptor sameKeyEncryptor = new ApiKeyEncryptor(TEST_SECRET, TEST_SALT);

            // when
            String decrypted = sameKeyEncryptor.decrypt(encrypted);

            // then
            assertThat(decrypted).isEqualTo(original);
        }
    }
}
