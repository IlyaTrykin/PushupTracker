package app.pushuptracker.mobile;

import android.os.Bundle;
import app.pushuptracker.mobile.plugins.BackgroundUploadPlugin;
import app.pushuptracker.mobile.plugins.SecureTokenPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Локальные плагины приложения регистрируются до создания моста.
        registerPlugin(SecureTokenPlugin.class);
        registerPlugin(BackgroundUploadPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
