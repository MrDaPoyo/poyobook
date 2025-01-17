fetch('/captcha')
    .then(response => response.json())
    .then(data => {
        const captchaDiv = document.getElementById('captcha-container');
        captchaDiv.innerHTML = `
            <p>Solve the following captcha: What is <strong>${data.question}</strong>?</p>
            <input type="number" id="captchaAnswer" placeholder="Enter your answer">
            <input type="hidden" id="captchaToken" value="${data.token}">
        `;
    })
    .catch(error => console.error('Error fetching captcha:', error));