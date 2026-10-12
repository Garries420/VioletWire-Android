package io.github.garries420.violetwire;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** OAuth tokens are encrypted with a non-exportable Android Keystore key. */
final class SecureTokenStore {
    private static final String ALIAS = "violetwire.oauth.v1";
    private final SharedPreferences preferences;

    SecureTokenStore(Context context) {
        preferences = context.getSharedPreferences("violetwire-secure", Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    synchronized String read() throws Exception { return read("token"); }
    synchronized String read(String record) throws Exception {
        String stored = preferences.getString(record, null);
        if (stored == null) return null;
        String[] parts = stored.split(":", 2);
        if (parts.length != 2) throw new IllegalStateException("Invalid encrypted token format");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8);
    }

    synchronized void write(String value) throws Exception { write("token", value); }
    synchronized void write(String record, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
            Base64.encodeToString(cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!preferences.edit().putString(record, stored).commit()) throw new IllegalStateException("Token write failed");
    }

    synchronized void remove() { remove("token"); }
    synchronized void remove(String record) {
        if (!preferences.edit().remove(record).commit()) throw new IllegalStateException("Token removal failed");
    }
}
