package com.newsinsight.collector.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.Base64;

/**
 * API 키 암호화/복호화 유틸리티.
 * 
 * AES-256-GCM 암호화를 사용하여 API 키를 안전하게 저장합니다.
 * 
 * 저장 형식: Base64(iv + encryptedData + authTag)
 */
@Component
@Slf4j
public class ApiKeyEncryptor {

    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;
    private static final int ITERATION_COUNT = 65536;
    private static final int KEY_LENGTH = 256;
    
    private final SecretKey secretKey;
    private final SecureRandom secureRandom;

    public ApiKeyEncryptor(
            @Value("${newsinsight.encryption.secret:defaultSecretKeyForDevelopmentOnly32}") String secretKeyString,
            @Value("${newsinsight.encryption.salt:defaultSaltValue16ch}") String saltString
    ) {
        this.secretKey = deriveKey(secretKeyString, saltString);
        this.secureRandom = new SecureRandom();
        log.info("ApiKeyEncryptor initialized with AES-256-GCM encryption");
    }

    /**
     * 비밀번호와 salt로부터 AES 키 유도
     */
    private SecretKey deriveKey(String password, String salt) {
        try {
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            KeySpec spec = new PBEKeySpec(
                    password.toCharArray(),
                    salt.getBytes(StandardCharsets.UTF_8),
                    ITERATION_COUNT,
                    KEY_LENGTH
            );
            SecretKey tmp = factory.generateSecret(spec);
            return new SecretKeySpec(tmp.getEncoded(), "AES");
        } catch (Exception e) {
            log.error("Failed to derive encryption key", e);
            throw new RuntimeException("Failed to initialize encryption", e);
        }
    }

    /**
     * API 키 암호화
     * 
     * @param plaintext 평문 API 키
     * @return 암호화된 Base64 문자열 (prefix: "ENC:")
     */
    public String encrypt(String plaintext) {
        if (plaintext == null || plaintext.isBlank()) {
            return plaintext;
        }
        
        // 이미 암호화된 경우 그대로 반환
        if (isEncrypted(plaintext)) {
            return plaintext;
        }

        try {
            // 랜덤 IV 생성
            byte[] iv = new byte[GCM_IV_LENGTH];
            secureRandom.nextBytes(iv);

            // 암호화
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            GCMParameterSpec parameterSpec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, parameterSpec);
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            // IV + 암호문 결합
            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);

            // Base64 인코딩 + prefix 추가
            return "ENC:" + Base64.getEncoder().encodeToString(combined);

        } catch (Exception e) {
            log.error("Failed to encrypt API key", e);
            throw new RuntimeException("Encryption failed", e);
        }
    }

    /**
     * API 키 복호화
     * 
     * @param encrypted 암호화된 문자열 (prefix: "ENC:")
     * @return 평문 API 키
     */
    public String decrypt(String encrypted) {
        if (encrypted == null || encrypted.isBlank()) {
            return encrypted;
        }
        
        // 암호화되지 않은 평문인 경우 그대로 반환 (하위 호환성)
        if (!isEncrypted(encrypted)) {
            log.debug("Returning plain text API key (not encrypted)");
            return encrypted;
        }

        try {
            // prefix 제거 후 Base64 디코딩
            String base64Data = encrypted.substring(4); // "ENC:" 제거
            byte[] combined = Base64.getDecoder().decode(base64Data);

            // IV 추출
            byte[] iv = new byte[GCM_IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, iv.length);

            // 암호문 추출
            byte[] ciphertext = new byte[combined.length - iv.length];
            System.arraycopy(combined, iv.length, ciphertext, 0, ciphertext.length);

            // 복호화
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            GCMParameterSpec parameterSpec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, parameterSpec);
            byte[] plaintext = cipher.doFinal(ciphertext);

            return new String(plaintext, StandardCharsets.UTF_8);

        } catch (Exception e) {
            log.error("Failed to decrypt API key", e);
            throw new RuntimeException("Decryption failed", e);
        }
    }

    /**
     * 문자열이 암호화된 상태인지 확인
     */
    public boolean isEncrypted(String value) {
        return value != null && value.startsWith("ENC:");
    }

    /**
     * API 키 마스킹 (표시용)
     * 복호화 후 마스킹 적용
     */
    public String getMaskedKey(String encryptedOrPlain) {
        if (encryptedOrPlain == null || encryptedOrPlain.isBlank()) {
            return "****";
        }

        String plainKey;
        try {
            plainKey = decrypt(encryptedOrPlain);
        } catch (Exception e) {
            // 복호화 실패 시 원본으로 마스킹
            plainKey = encryptedOrPlain;
        }

        if (plainKey.length() < 8) {
            return "****";
        }
        
        return plainKey.substring(0, 4) + "****" + plainKey.substring(plainKey.length() - 4);
    }
}
