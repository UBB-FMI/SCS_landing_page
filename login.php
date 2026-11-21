<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const UBB_TENANT_ID = '5a4863ed-40c8-4fd5-8298-fbfdb7f13095';

if (isset($_POST['access_token'])) {
    $accessToken = $_POST['access_token'];

    $url = 'https://graph.microsoft.com/v1.0/me';
    $headers = [
        'Authorization: Bearer ' . $accessToken,
        'Content-Type: application/json'
    ];

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);

    $response = curl_exec($ch);
    $httpCode = $response === false ? 0 : curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode == 200) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, 'https://graph.microsoft.com/v1.0/organization?$select=id');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        $organizationResponse = curl_exec($ch);
        $organizationHttpCode = $organizationResponse === false ? 0 : curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($organizationHttpCode !== 200) {
            echo json_encode(['error' => 'Failed to verify organization', 'status' => $organizationHttpCode]);
            exit;
        }

        $organization = json_decode($organizationResponse, true);

        if (($organization['value'][0]['id'] ?? '') !== UBB_TENANT_ID) {
            echo json_encode(['error' => 'Invalid student account']);
            exit;
        }

        $userData = json_decode($response, true);
        $userEmail = $userData['mail'] ?? '';

        if (!str_ends_with($userEmail, 'stud.ubbcluj.ro')) {
            echo json_encode(['error' => 'Invalid student account']);
            exit;
        }

        // Inițializăm vectorii pentru username și password
        $usernames = [];
        $passwords = [];

        if (($handle = fopen("conturi.csv", "r")) !== false) {
            while (($data = fgetcsv($handle, 0, ",")) !== false) {
                if ($data[8] === $userEmail) {  
                    $usernames[] = $data[0];  
                    $passwords[] = $data[1];  
                }
            }
            fclose($handle);
        }

        echo json_encode([
            'displayName' => $userData['displayName'] ?? 'Not available',
            'mail' => $userEmail,
            'usernames' => $usernames,  // Returnează vectorul de username-uri
            'passwords' => $passwords   // Returnează vectorul de parole
        ]);
    } else {
        echo json_encode(['error' => 'Failed to fetch user data', 'status' => $httpCode]);
    }
} else {
    echo json_encode(['error' => 'No access token provided']);
}
?>
